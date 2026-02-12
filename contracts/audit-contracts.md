# StabL Gateway — Smart Contract Audit & Production Roadmap

**Date:** February 12, 2026  
**Scope:** PaymentPool.sol, IntentVault.sol, BatchSettler.sol  
**Compiler:** Solidity ^0.8.30 | Foundry | OpenZeppelin 5.x  
**Current deployment:** Arc Testnet  
**Target:** Arc Mainnet (production)

---

## 1. Executive Summary

The contracts are well-structured for a hackathon MVP — clean separation of concerns, good use of SafeERC20, atomic batch execution, and solid test coverage (45+ tests including fuzz). However, there are **critical gaps** that must be addressed before handling real funds on mainnet.

**Severity breakdown:**

| Severity    | Count | Summary                                                                                                                    |
| ----------- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| 🔴 Critical | 3     | Reentrancy risk, no pause mechanism, no upgradeability                                                                     |
| 🟠 High     | 5     | Missing token whitelist, no batch size limit, no duplicate payment protection, missing `deleteIntent`, centralization risk |
| 🟡 Medium   | 6     | Missing events, gas optimizations, no emergency withdraw, no fee mechanism, no intent expiry, no merchant registry         |
| 🔵 Low      | 4     | Custom errors, NatSpec gaps, deployment script hardening, test edge cases                                                  |

---

## 2. Contract-by-Contract Analysis

### 2.1 PaymentPool.sol

**Current state:** Functional vault with per-merchant, per-token balance tracking.

#### 🔴 CRITICAL: Reentrancy on `withdraw()`

```solidity
// CURRENT — state change AFTER external call
function withdraw(address merchant, address token, uint256 amount, address recipient) external {
    require(authorizedWithdrawers[msg.sender], "PaymentPool: not authorized");
    require(recipient != address(0), "PaymentPool: recipient is zero address");
    require(balances[merchant][token] >= amount, "PaymentPool: insufficient balance");

    balances[merchant][token] -= amount;          // ← state change
    IERC20(token).safeTransfer(recipient, amount); // ← external call
}
```

While the state change happens before the transfer (correct CEI pattern), there is **no reentrancy guard**. If `recipient` is a contract with a `fallback`/`receive` that calls back into PaymentPool (e.g., via another authorized withdrawer path), state could be inconsistent. SafeERC20 mitigates some risk since standard ERC20 transfers don't trigger callbacks, but some ERC777-compatible tokens do.

**Fix:** Add OpenZeppelin's `ReentrancyGuard` to both `receivePayment()` and `withdraw()`.

#### 🟠 HIGH: No token whitelist

Anyone can call `receivePayment()` with _any_ ERC20 address. A malicious token contract could:

- Revert on `transferFrom` selectively (griefing)
- Have a fee-on-transfer mechanism that creates balance accounting mismatches
- Implement ERC777 hooks that enable reentrancy

**Fix:** Add a `supportedTokens` mapping that the owner manages. Only whitelisted tokens can be deposited.

#### 🟠 HIGH: No duplicate payment ID protection

```solidity
function receivePayment(address merchant, address token, uint256 amount, bytes32 paymentId) external {
    // paymentId is only emitted in the event — never checked for uniqueness
}
```

The same `paymentId` can be used multiple times. The backend is currently responsible for deduplication, but on-chain enforcement is safer.

**Fix:** Add `mapping(bytes32 => bool) private processedPayments` and require `!processedPayments[paymentId]`.

#### 🟡 MEDIUM: `FundsWithdrawn` event is missing key fields

```solidity
event FundsWithdrawn(address indexed merchant, address indexed token, uint256 amount);
// Missing: recipient address, who triggered the withdrawal
```

**Fix:** Add `recipient` and `withdrawer` (msg.sender) to the event.

#### 🟡 MEDIUM: No emergency withdraw / pause

If a vulnerability is discovered post-deployment, there's no way to pause the contract or emergency-withdraw funds. The owner can only toggle authorized withdrawers.

**Fix:** Add OpenZeppelin's `Pausable`. Add an `emergencyWithdraw()` function callable only by owner that can sweep all tokens of a given type. Add `whenNotPaused` modifier to `receivePayment()` and `withdraw()`.

#### 🟡 MEDIUM: No merchant registry

`receivePayment()` accepts any address as `merchant`. There's no concept of a registered merchant on-chain. This means:

- Funds can be deposited to an address that has no intent set
- Funds sit in the pool with no way to settle them
- Requires backend to filter valid merchants

**Fix:** Either add a merchant registry to PaymentPool or validate `intentVault.hasIntent(merchant)` on deposit. The latter creates a cross-contract dependency but ensures every deposited payment can eventually be settled.

---

### 2.2 IntentVault.sol

**Current state:** Clean intent storage with proper validation per settlement speed.

#### 🟠 HIGH: No `deleteIntent()` function

Merchants can _update_ their intent but never _delete_ it. Once `exists = true`, it stays forever. This means:

- Merchants who want to stop using StabL can't opt out on-chain
- `hasIntent()` returns true permanently
- No way to "deregister"

**Fix:**

```solidity
function deleteIntent() external {
    require(intents[msg.sender].exists, "IntentVault: no intent to delete");
    delete intents[msg.sender];
    emit IntentDeleted(msg.sender);
}
```

#### 🟡 MEDIUM: No intent expiry / TTL

Intents live forever. A merchant who set `STANDARD` with `maxWaitTimeSeconds: 3600` a year ago still has an active intent. The `maxWaitTimeSeconds` is only meaningful relative to payment timestamps — it's the backend's job to interpret, but stale intents waste gas when BatchSettler reads them.

**Fix:** Add `uint256 updatedAt` to `MerchantIntent`. The backend can then ignore stale intents, and a future version could add on-chain expiry.

#### 🟡 MEDIUM: Only merchants can set their own intent

Currently `setIntent()` uses `msg.sender` as the merchant. This is secure, but it means:

- The backend can't set intents on behalf of merchants (e.g., during onboarding)
- No delegation pattern

**Fix (optional, for v2):** Add a `setIntentFor(address merchant, ...)` function with an approval/delegation mechanism, or accept EIP-712 signed intents.

---

### 2.3 BatchSettler.sol

**Current state:** Atomic batch execution with good validation. `validateBatch()` is a nice touch.

#### 🔴 CRITICAL: No pause mechanism

If a bug is found in batch logic, there's no way to stop settlements. The owner would have to:

1. Deploy a new BatchSettler
2. Deauthorize the old one on PaymentPool
3. Authorize the new one

This multi-step process leaves a window where settlements could still execute.

**Fix:** Add `Pausable` with `whenNotPaused` on `executeBatch()`.

#### 🔴 CRITICAL: No upgradeability pattern

All three contracts are non-upgradeable. If a critical bug is found:

- PaymentPool holds all the funds and can't be migrated without withdrawing everything
- BatchSettler is immutable-linked to PaymentPool and IntentVault addresses
- No proxy pattern means redeployment + full migration

**Fix options:**

1. **Recommended for v1:** Keep non-upgradeable but add migration helpers (batch emergency withdrawal, new settler authorization). Simpler to audit, less attack surface.
2. **For v2:** Consider UUPS proxy (OpenZeppelin) for PaymentPool only, since that's where funds live.

#### 🟠 HIGH: No batch size limit

```solidity
function executeBatch(bytes32 batchId, Settlement[] calldata settlements, uint256 totalGasSaved)
    external onlyOwner
{
    require(settlements.length > 0, "BatchSettler: empty batch");
    // No upper bound on settlements.length
```

A batch with 1000 settlements could hit the block gas limit and always revert. This creates a griefing vector if the backend logic is misconfigured.

**Fix:** Add `require(settlements.length <= MAX_BATCH_SIZE)` with a configurable `MAX_BATCH_SIZE` (e.g., 50).

#### 🟠 HIGH: Centralization — single owner controls all settlements

`executeBatch()` is `onlyOwner`. If the owner key is compromised, an attacker can:

- Settle any merchant's funds to any `recipient` address (effectively stealing funds)
- Drain the entire PaymentPool

This is the biggest trust assumption in the system.

**Fix options:**

1. **Short term:** Use a multisig (Safe) as the owner instead of an EOA
2. **Medium term:** Add a timelock for large settlements (e.g., > 10k USDC)
3. **Long term:** Move to a role-based system with multiple signers for different thresholds

#### 🟡 MEDIUM: No fee mechanism

There's no way for StabL to take a fee on settlements. For a production payment system, you need a revenue model on-chain.

**Fix:** Add a `feeRecipient` address and `feeBasisPoints` (e.g., 30 = 0.3%). Deduct fee before transferring to merchant's recipient.

```solidity
uint256 fee = (s.amount * feeBasisPoints) / 10000;
uint256 netAmount = s.amount - fee;
IERC20(s.token).safeTransfer(s.recipient, netAmount);
if (fee > 0) IERC20(s.token).safeTransfer(feeRecipient, fee);
```

---

## 3. Cross-Contract Issues

### 3.1 Funds flow has a double-hop problem

In `executeBatch()`, for each settlement:

1. `paymentPool.withdraw(merchant, token, amount, address(this))` — funds go to BatchSettler
2. `IERC20(token).safeTransfer(recipient, amount)` — funds go to recipient

This means BatchSettler holds tokens transiently. If the transaction reverts between step 1 and step 2, tokens are stuck in BatchSettler. The atomic nature of the batch prevents this within a single call, but it's worth noting.

**Optimization:** Modify `PaymentPool.withdraw()` to send directly to the final recipient, eliminating the double-hop:

```solidity
paymentPool.withdraw(s.merchant, s.token, s.amount, s.recipient);
// No need for BatchSettler to hold and re-transfer
```

This saves ~5000 gas per settlement (one fewer ERC20 transfer) and eliminates the transient holding risk.

### 3.2 No cross-contract version checking

BatchSettler has `immutable` references to PaymentPool and IntentVault. If either contract is redeployed (upgraded), BatchSettler points to dead addresses. There's no way to detect this on-chain.

---

## 4. Gas Optimizations

| Optimization                                        | Savings                  | Effort |
| --------------------------------------------------- | ------------------------ | ------ |
| Custom errors instead of string reverts             | ~200 gas per revert      | Low    |
| `unchecked` for loop increment in `executeBatch`    | ~60 gas per iteration    | Low    |
| Direct withdraw to recipient (eliminate double-hop) | ~5000 gas per settlement | Medium |
| Pack `MerchantIntent` struct (reorder fields)       | ~2000 gas on reads       | Low    |
| Cache `settlements.length` in `executeBatch`        | ~100 gas                 | Low    |

### Custom errors example:

```solidity
// Replace string reverts
error PaymentPool__NotAuthorized();
error PaymentPool__ZeroAddress();
error PaymentPool__InsufficientBalance(address merchant, address token, uint256 requested, uint256 available);
error PaymentPool__UnsupportedToken(address token);
```

### Loop optimization:

```solidity
uint256 len = settlements.length;
for (uint256 i; i < len; ) {
    // ... process settlement
    unchecked { ++i; }
}
```

---

## 5. Missing Tests

The test suite is solid but missing some important edge cases:

| Test                             | Contract     | Why                                                          |
| -------------------------------- | ------------ | ------------------------------------------------------------ |
| Fee-on-transfer token            | PaymentPool  | Balance accounting breaks if token takes a fee               |
| Reentrant token callback         | PaymentPool  | ERC777-compatible tokens can call back                       |
| Max batch size gas usage         | BatchSettler | Find the practical gas limit                                 |
| Same merchant twice in one batch | BatchSettler | Could double-withdraw                                        |
| Concurrent batch execution       | BatchSettler | Two batches referencing same merchant                        |
| Zero-balance withdrawal attempt  | BatchSettler | Edge case where balance drained between validate and execute |
| Token with different decimals    | All          | Ensure 6-decimal and 18-decimal tokens both work             |

---

## 6. Production Roadmap — Phased Implementation

### Phase 1: Security Hardening (Week 1-2)

**Goal:** Make contracts mainnet-safe without changing architecture.

- [ ] Add `ReentrancyGuard` to PaymentPool
- [ ] Add `Pausable` to all three contracts
- [ ] Add token whitelist to PaymentPool
- [ ] Add duplicate paymentId protection
- [ ] Add `deleteIntent()` to IntentVault
- [ ] Add `MAX_BATCH_SIZE` to BatchSettler
- [ ] Replace string reverts with custom errors
- [ ] Apply gas optimizations (unchecked loops, struct packing)
- [ ] Eliminate double-hop in BatchSettler
- [ ] Expand test suite with edge cases from Section 5
- [ ] Add `updatedAt` to MerchantIntent struct
- [ ] Enhance events with missing fields

### Phase 2: Access Control & Fees (Week 3)

**Goal:** Production access control and revenue model.

- [ ] Deploy a Safe multisig for contract ownership
- [ ] Add fee mechanism to BatchSettler
- [ ] Add emergency withdrawal functions
- [ ] Add migration helper (batch-withdraw all merchants for a token)
- [ ] Consider adding merchant registry (optional)
- [ ] Write comprehensive deployment scripts with verification

### Phase 3: Audit Preparation (Week 4)

**Goal:** Code freeze + documentation for external review.

- [ ] Code freeze — no new features
- [ ] 100% NatSpec documentation on all public/external functions
- [ ] Generate gas reports (`forge test --gas-report`)
- [ ] Write invariant tests (Foundry invariant testing)
- [ ] Document all trust assumptions and known limitations
- [ ] Consider running Slither / Mythril static analysis
- [ ] Prepare audit-ready README with threat model

---

## 7. Recommended Contract Architecture (Post-Hardening)

```
┌─────────────────────────────────────────┐
│            PaymentPool.sol              │
│  + ReentrancyGuard                      │
│  + Pausable                             │
│  + Token whitelist                      │
│  + Duplicate payment protection         │
│  + Emergency withdraw                   │
│  + Enhanced events                      │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────┴───────────────────────┐
│            IntentVault.sol              │
│  + deleteIntent()                       │
│  + updatedAt timestamp                  │
│  + (v2: delegation / meta-transactions) │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────┴───────────────────────┐
│           BatchSettler.sol              │
│  + Pausable                             │
│  + Max batch size                       │
│  + Fee mechanism                        │
│  + Direct-to-recipient settlement       │
│  + Custom errors                        │
│  + Owner = Safe multisig                │
└─────────────────────────────────────────┘
```

---

## 8. Quick Wins to Start With

If you want to start coding today, here's the order I'd tackle things:

1. **ReentrancyGuard + Pausable** — 30 min, highest security impact
2. **Custom errors** — 45 min, improves gas + developer UX
3. **Token whitelist** — 30 min, prevents malicious token attacks
4. **Duplicate paymentId check** — 15 min, simple but important
5. **deleteIntent()** — 15 min, quick addition
6. **MAX_BATCH_SIZE** — 10 min, one require statement
7. **Eliminate double-hop** — 30 min, architecture improvement
8. **Expand tests** — 2-3 hours, covers all new functionality

Total estimated time for Phase 1: ~2 working days of focused development.
