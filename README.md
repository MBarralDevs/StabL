<p align="center">
  <img src="frontend/public/logo.png" alt="StabL" width="100" height="100" />
</p>

<h1 align="center">StabL Gateway</h1>

<p align="center">
  <strong>Intent-based stablecoin payment gateway with batched settlement</strong>
</p>

<p align="center">
  <a href="https://stabl-arc.vercel.app">Live Demo</a> •
  <a href="https://testnet.arcscan.app/address/0xf929d461B266a671A4AE6dC731cB7107b57946B2">Contracts on ArcScan</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#getting-started">Getting Started</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Solidity-0.8.30-blue" />
  <img src="https://img.shields.io/badge/Next.js-14-black" />
  <img src="https://img.shields.io/badge/Arc_Testnet-Live-green" />
  <img src="https://img.shields.io/badge/CCTP_V2-Integrated-purple" />
  <img src="https://img.shields.io/badge/Uniswap_V4-Hook-pink" />
</p>

---

## What is StabL?

StabL is a payment gateway that lets merchants accept stablecoin payments from any blockchain while reducing settlement costs through intelligent batching — like a carpool for transactions.

**The problem:** Stablecoin payment systems force merchants to choose between speed (pay high gas per transaction) and cost (wait indefinitely for cheaper settlement).

**The solution:** StabL decouples payment receipt from settlement. Merchants declare their settlement preferences (speed vs. cost), and the protocol batches compatible settlements to minimize gas — the more merchants use StabL, the cheaper it gets for everyone.

### Key Features

- **Merchant-controlled settlement** — Choose Immediate, Standard, or Deferred settlement. Your funds, your rules.
- **Batched settlement** — Multiple payments settle in one transaction via BatchSettler, sharing gas costs across merchants.
- **Cross-chain payments** — Accept USDC from Ethereum, Base, and more via Circle's CCTP V2.
- **Cross-token swaps** — Receive USDC, settle in EURC. Powered by Uniswap V4 Hooks.
- **Full merchant dashboard** — Real-time payment tracking, settlement history, and intent management.
- **Non-custodial** — All funds are held in audited smart contracts. No intermediary custody.

---

## Live Demo

**Frontend:** [stabl-arc.vercel.app](https://stabl-arc.vercel.app)

**Backend API:** [stabl-production.up.railway.app](https://stabl-production.up.railway.app/health)

**Deployed Contracts (Arc Testnet — verified on [ArcScan](https://testnet.arcscan.app)):**

| Contract     | Address                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| PaymentPool  | [`0xf929d461B266a671A4AE6dC731cB7107b57946B2`](https://testnet.arcscan.app/address/0xf929d461B266a671A4AE6dC731cB7107b57946B2) |
| IntentVault  | [`0x992f46a9Da4458243a05A884D4bD68A851eA1942`](https://testnet.arcscan.app/address/0x992f46a9Da4458243a05A884D4bD68A851eA1942) |
| BatchSettler | [`0x63626B6668BABc18c35e55a1982Ff8aD2C816DA9`](https://testnet.arcscan.app/address/0x63626B6668BABc18c35e55a1982Ff8aD2C816DA9) |
| CCTPReceiver | [`0x3ea746C6aC0E3D7E38d83d43bF979451DAbFd490`](https://testnet.arcscan.app/address/0x3ea746C6aC0E3D7E38d83d43bF979451DAbFd490) |

---

## Architecture

```
                    ┌──────────────────┐
                    │    Customer      │
                    │  (Any Chain)     │
                    └────────┬─────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
    ┌─────────────────┐          ┌─────────────────┐
    │   Direct (Arc)  │          │    CCTP V2       │
    │  USDC Payment   │          │  Cross-chain     │
    └────────┬────────┘          └────────┬────────┘
              │                            │
              ▼                            ▼
    ┌──────────────────────────────────────────────┐
    │             PaymentPool Contract             │
    │     Receives payments, tracks balances        │
    │         Emits PaymentReceived event           │
    └──────────────────────┬───────────────────────┘
                           │ Event (WebSocket)
                           ▼
    ┌──────────────────────────────────────────────┐
    │              Backend Pipeline                 │
    │                                              │
    │  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
    │  │ Payment  │→ │ Intent   │→ │  Batch    │  │
    │  │ Consumer │  │ Checker  │  │ Executor  │  │
    │  └──────────┘  └──────────┘  └───────────┘  │
    │       ↓              ↓             ↓         │
    │   PostgreSQL    IntentVault   BatchSettler    │
    │    (Neon)       (on-chain)    (on-chain)     │
    │                                              │
    │  Connected via Redis Streams (Upstash)       │
    └──────────────────────┬───────────────────────┘
                           │
                           ▼
    ┌──────────────────────────────────────────────┐
    │            BatchSettler Contract              │
    │   Atomic batch settlement on-chain            │
    │   Routes cross-token via Uniswap V4 Hook     │
    │   Sends funds directly to merchant wallet     │
    └──────────────────────────────────────────────┘
```

### How Settlement Works

1. **Customer pays** — sends USDC to PaymentPool (directly on Arc, or cross-chain via CCTP V2)
2. **Event detected** — backend WebSocket listener picks up `PaymentReceived` event
3. **Database recorded** — payment persisted to PostgreSQL via Prisma
4. **Intent checked** — backend reads merchant's on-chain intent from IntentVault:
   - **Immediate** → settle now
   - **Standard** → wait N seconds for batch partners
   - **Deferred** → wait until balance hits threshold
5. **Batch settled** — BatchSettler executes atomic on-chain settlement, routing through V4 Hook if cross-token swap is needed
6. **Merchant receives funds** — USDC (or target token) transferred to merchant wallet

### Settlement Intents

| Intent        | Behavior                                 | Gas Cost | Best For                  |
| ------------- | ---------------------------------------- | -------- | ------------------------- |
| **Immediate** | Every payment settles instantly          | Highest  | Speed-sensitive merchants |
| **Standard**  | Waits up to N seconds for batch partners | Medium   | Balanced speed/cost       |
| **Deferred**  | Waits until balance reaches threshold    | Lowest   | High-volume merchants     |

---

## Tech Stack

### Smart Contracts

- **Solidity 0.8.30** with Foundry
- **OpenZeppelin** — SafeERC20, Ownable, Pausable, ReentrancyGuard
- **Uniswap V4** — PaymentSettlementHook for cross-token swaps
- **170+ Foundry tests** including fuzz testing

### Backend

- **TypeScript** with Express
- **ethers.js v6** — blockchain interactions
- **Redis Streams** (Upstash) — event-driven pipeline
- **PostgreSQL** (Neon) + Prisma ORM
- **WebSocket** — real-time Arc event listening
- **CCTP V2** — cross-chain USDC relay service
- **Li.Fi SDK** — fallback for non-USDC routing
- **119 Vitest tests**

### Frontend

- **Next.js 14** (App Router)
- **Tailwind CSS** — dark forest green theme
- **RainbowKit + wagmi** — wallet connection
- **recharts** — volume charts
- **tsparticles** — landing page animations

### Infrastructure

- **Vercel** — frontend hosting
- **Railway** — backend hosting (full pipeline)
- **Neon** — managed PostgreSQL
- **Upstash** — managed Redis
- **Arc Testnet** — EVM chain with gas paid in USDC

---

## Project Structure

```
StablecoinGateway/
├── contracts/                 # Foundry project
│   ├── src/
│   │   ├── PaymentPool.sol        # Receives payments, tracks balances
│   │   ├── IntentVault.sol        # On-chain settlement preferences
│   │   ├── BatchSettler.sol       # Atomic batch settlement
│   │   ├── CCTPReceiver.sol       # Cross-chain USDC receiver
│   │   └── PaymentSettlementHook.sol  # Uniswap V4 Hook
│   ├── test/                  # 170+ tests with fuzz testing
│   └── script/                # Deploy + test flow scripts
│
├── backend/                   # TypeScript backend
│   ├── src/
│   │   ├── index.ts               # Main orchestrator + API
│   │   ├── api/                   # REST API routes
│   │   ├── listeners/             # Arc + CCTP event listeners
│   │   ├── consumers/             # Redis Stream consumers
│   │   ├── services/              # CCTP relayer, Li.Fi, database
│   │   └── config/                # Contracts, Redis, env
│   └── prisma/                # Database schema
│
└── frontend/                  # Next.js dashboard
    ├── app/
    │   ├── page.tsx               # Landing page (animated)
    │   ├── overview/              # Dashboard with stats + charts
    │   ├── pay/                   # Checkout-style payment widget
    │   ├── payments/              # Transaction history
    │   ├── settlements/           # Batch settlement history
    │   ├── cctp/                  # Cross-chain status
    │   ├── settings/              # Intent management
    │   └── about/                 # Product info
    ├── components/            # Sidebar, Toast, Skeleton, etc.
    └── lib/                   # Wallet config (Arc chain)
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Foundry (`curl -L https://foundry.paradigm.xyz | bash`)
- MetaMask with Arc Testnet configured

### Arc Testnet Setup

Add to MetaMask:

| Field        | Value                             |
| ------------ | --------------------------------- |
| Network Name | Arc Testnet                       |
| RPC URL      | `https://rpc.testnet.arc.network` |
| Chain ID     | `5042002`                         |
| Currency     | `ETH`                             |
| Explorer     | `https://testnet.arcscan.app`     |

### 1. Clone & Install

```bash
git clone https://github.com/MBarralDevs/StabL
cd StablecoinGateway

# Contracts
cd contracts && forge install && cd ..

# Backend
cd backend && npm install && cd ..

# Frontend
cd frontend && npm install && cd ..
```

### 2. Environment Setup

**`backend/.env`:**

```bash
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_WSS_URL=wss://rpc.testnet.arc.network
DEPLOYER_PRIVATE_KEY=<your-private-key>
PAYMENT_POOL_ADDRESS=0xf929d461B266a671A4AE6dC731cB7107b57946B2
INTENT_VAULT_ADDRESS=0x992f46a9Da4458243a05A884D4bD68A851eA1942
BATCH_SETTLER_ADDRESS=0x63626B6668BABc18c35e55a1982Ff8aD2C816DA9
CCTP_RECEIVER_ADDRESS=0x3ea746C6aC0E3D7E38d83d43bF979451DAbFd490
REDIS_URL=<your-upstash-url>
DATABASE_URL=<your-neon-url>?connection_limit=5&pool_timeout=30
LIFI_INTEGRATOR=StabL-Gateway
```

### 3. Run Locally

```bash
# Terminal 1: Backend (event listener + consumers + API)
cd backend && npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev
```

- Frontend: http://localhost:3001
- Backend API: http://localhost:3000/api/payments
- Health check: http://localhost:3000/health

### 4. Send a Test Payment

```bash
cd contracts
forge script script/TestPaymentFlow.s.sol:TestPaymentFlow \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key <your-key> \
  --broadcast
```

Or use the Pay page at http://localhost:3001/pay with MetaMask.

---

## Testing

### Smart Contracts (170+ tests)

```bash
cd contracts

# Run all tests
forge test

# With gas report
forge test --gas-report

# Specific file
forge test --match-path test/BatchSettler.t.sol

# Coverage
forge coverage
```

### Backend (119 tests)

```bash
cd backend
npm test
```

Test suites cover:

- CCTP V2 configuration and relay state machine
- Payment processing and deduplication
- Intent threshold evaluation (all 3 speeds)
- Batch settlement execution and error handling

---

## Security

### Smart Contracts

- **Atomic settlements** — entire batch succeeds or reverts
- **Access control** — only authorized BatchSettler can withdraw from PaymentPool
- **ReentrancyGuard** — on all state-changing functions
- **Pausable** — emergency stop on all contracts
- **Token whitelist** — only approved tokens accepted
- **SafeERC20** — handles non-standard token implementations
- **Fuzz testing** — Foundry runs 256+ random inputs per fuzz test

### Backend

- **Event replay protection** — database tracks processed payment IDs
- **Redis consumer groups** — exactly-once message processing
- **Graceful shutdown** — completes in-flight transactions before stopping
- **Connection pool management** — Neon-compatible limits prevent exhaustion

---

## Roadmap

### Completed

- [x] Core contracts (PaymentPool, IntentVault, BatchSettler, CCTPReceiver)
- [x] Uniswap V4 PaymentSettlementHook
- [x] Backend pipeline (event listener → consumers → settlement)
- [x] CCTP V2 cross-chain relay service
- [x] Frontend merchant dashboard with wallet connect
- [x] Checkout-style payment widget
- [x] Arc testnet deployment (all contracts verified)
- [x] Production deployment (Vercel + Railway)

### Planned

- [ ] **Cross-merchant netting** — collapse offsetting flows (User1→User2→User3 becomes User1→User3)
- [ ] **Default intent for new merchants** — IntentVault returns IMMEDIATE when no intent exists
- [ ] **SDK** — `npm install @stabl/sdk` for easy website integration
- [ ] **Developer documentation** — hosted docs site
- [ ] **Multi-chain source monitoring** — enable ETH Sepolia + Base Sepolia CCTP listeners

---

## Origin

StabL was built during **HackMoney 2026** (ETH Global) and evolved into a post-hackathon project. The architecture independently arrived at similar patterns to Circle's Gateway (batched settlement, cross-chain USDC), with unique differentiators: merchant-controlled settlement intents, Uniswap V4 Hook integration, and a self-sovereign trust model.

---

## License

MIT

---

<p align="center">
  Built on <a href="https://arc.network">Arc Network</a> • 
  <a href="https://developers.circle.com/cctp">CCTP V2</a> • 
  <a href="https://docs.uniswap.org/contracts/v4/overview">Uniswap V4</a> • 
  <a href="https://li.fi">Li.Fi</a>
</p>
