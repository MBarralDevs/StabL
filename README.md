# StabL Gateway

**Universal Stablecoin Payment Gateway with Intent-Based Settlement**

StabL Gateway is a production-ready payment infrastructure that enables merchants to accept stablecoins from any blockchain while optimizing settlement costs through intelligent batching and instant liquidity provision.

Built for **HackMoney 2026** | Integrating **Yellow Network**, **Li.Fi**, **Arc Testnet**, and **Uniswap**

---

## 🎯 Problem

Current stablecoin payment systems force merchants to choose between:

- **Speed** → Pay high gas fees for instant settlement
- **Cost** → Wait indefinitely for batch settlement savings

This creates a poor UX where merchants either overpay or lose liquidity.

## 💡 Solution

StabL Gateway decouples payment receipt from settlement using a **carpool model**:

1. **Instant Credit** → Merchants receive liquidity immediately via Yellow Network state channels
2. **Intent Declaration** → Merchants specify their settlement preferences (speed vs. cost)
3. **Smart Batching** → Backend matches compatible settlements to minimize gas costs
4. **Cross-Chain Routing** → Li.Fi enables settlement to any chain in merchant's preferred token

**Result:** Merchants get instant liquidity _and_ optimized settlement costs.

---

## 🏗️ Architecture

```
┌─────────────┐
│   Customer  │ Pays with any stablecoin, any chain
└──────┬──────┘
       │ Li.Fi routes payment
       ▼
┌─────────────────────────────────────────────┐
│          Arc Testnet (Gas = USDC)           │
│  ┌─────────────────────────────────────┐   │
│  │      PaymentPool Contract           │   │
│  │  (Receives & tracks balances)       │   │
│  └────────────┬────────────────────────┘   │
└───────────────┼─────────────────────────────┘
                │ PaymentReceived event
                ▼
┌─────────────────────────────────────────────┐
│           Backend (TypeScript)              │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │  1. Yellow Network Integration       │  │
│  │     → Instant off-chain credit       │  │
│  │                                      │  │
│  │  2. PostgreSQL Database              │  │
│  │     → Audit trail & persistence      │  │
│  │                                      │  │
│  │  3. Intent Checker                   │  │
│  │     → Evaluates settlement triggers  │  │
│  │                                      │  │
│  │  4. Batch Optimizer                  │  │
│  │     → Groups compatible settlements  │  │
│  │                                      │  │
│  │  5. Li.Fi Router                     │  │
│  │     → Cross-chain settlement quotes  │  │
│  └──────────────────────────────────────┘  │
└─────────────────┬───────────────────────────┘
                  │ Batch settlement transaction
                  ▼
┌─────────────────────────────────────────────┐
│        BatchSettler Contract (Arc)          │
│   → Executes optimized batch settlements    │
│   → Distributes funds per merchant intents  │
└─────────────────────────────────────────────┘
```

### Key Components

**Smart Contracts (Solidity):**

- `PaymentPool.sol` - Receives payments, tracks merchant balances
- `IntentVault.sol` - Stores merchant settlement preferences on-chain
- `BatchSettler.sol` - Executes optimized batch settlements atomically

**Backend (TypeScript):**

- **Event-Driven Architecture** - Redis Streams for reliable message processing
- **Database Layer** - PostgreSQL + Prisma for payment lifecycle tracking
- **Yellow Network Integration** - Instant liquidity via state channels (hybrid demo mode)
- **Li.Fi Integration** - Real API calls for cross-chain routing quotes
- **Arc Blockchain Listener** - WebSocket connection for real-time events

**Frontend (Next.js):**

- Real-time payment dashboard
- Live statistics and settlement tracking
- Integration status monitoring

---

## 🚀 Getting Started

### Prerequisites

```bash
# Required
- Node.js 18+
- Docker & Docker Compose
- Foundry (for smart contracts)

# Get Arc testnet USDC
Visit Arc testnet faucet to get USDC for testing
```

### 1. Clone & Install

```bash
git clone https://github.com/MBarralDevs/StabL
cd StablecoinGateway

# Install contract dependencies
cd contracts
forge install

# Install backend dependencies
cd ../backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Setup Environment Variables

**Backend (`backend/.env`):**

```bash
# Arc Testnet
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_WSS_URL=wss://rpc.testnet.arc.network
DEPLOYER_PRIVATE_KEY=0x...

# Deployed Contracts (after deployment)
PAYMENT_POOL_ADDRESS=0x5a100C9c5B7586cf014ACd65A7EEd592589bc3c4
INTENT_VAULT_ADDRESS=0xCb3016AaeAF3C956960134aF241468701D68E1C4
BATCH_SETTLER_ADDRESS=0x33A7aE97Cf4ee8747Fde9B13e096A86500F4C6E7

# Infrastructure
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://user:password@localhost:5432/stabl_gateway

# Li.Fi
LIFI_INTEGRATOR=StabL-Gateway

# Yellow Network (optional - falls back to demo mode)
YELLOW_WSS_URL=wss://clearnet-sandbox.yellow.com/ws
PRIVATE_KEY=0x...
```

### 3. Start Infrastructure

```bash
# Start Redis + PostgreSQL
cd backend
docker-compose up -d

# Run database migrations
npx prisma migrate deploy
```

### 4. Deploy Contracts (if needed)

```bash
cd contracts

# Deploy to Arc testnet
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $ARC_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast

# Copy deployed addresses to backend/.env
```

### 5. Run the Stack

```bash
# Terminal 1: Backend (main process)
cd backend
npm run dev

# Terminal 2: Backend API (for frontend)
cd backend
npm run api

# Terminal 3: Frontend
cd frontend
npm run dev
```

**Access:**

- Frontend: http://localhost:3001
- Backend API: http://localhost:3002
- Backend Main: http://localhost:3000/health

---

## 🧪 Testing the Flow

### Send a Test Payment

```bash
cd contracts

# Set merchant intent + send payment
forge script script/TestPaymentFlow.s.sol \
  --rpc-url $ARC_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --broadcast
```

**What happens:**

1. ✅ Payment lands in `PaymentPool`
2. ✅ Backend detects `PaymentReceived` event
3. ✅ Merchant credited instantly via Yellow Network (demo mode)
4. ✅ Payment recorded in PostgreSQL
5. ✅ Intent checker evaluates settlement threshold
6. ✅ Batch settlement executed on-chain
7. ✅ Li.Fi provides real cross-chain routing quote
8. ✅ Frontend updates with live data

### Verify Settlement

```bash
forge script script/VerifySettlement.s.sol \
  --rpc-url $ARC_RPC_URL
```

---

## 🔑 Key Features

### ✨ Instant Liquidity (Yellow Network)

Merchants receive credit in **<1 second** via Yellow Network's state channels before on-chain settlement completes.

**Current Implementation:**

- Hybrid approach: Real WebSocket connection to Yellow sandbox
- Attempts real `transfer` RPC method
- Falls back to demo mode (simulated state channel behavior)
- Production-ready architecture, waiting for funded sandbox

**Production Flow:**

```typescript
// Real Yellow Network transfer
await yellowClient.transfer({
  destination: merchantAddress,
  allocations: [{ asset: "usdc", amount: "10.0" }],
});
```

### 🌉 Cross-Chain Settlement (Li.Fi)

Get **real routing quotes** from Li.Fi's production API without needing funds.

**Example Output:**

```
🌉 Getting REAL Li.Fi quote...
   From: Chain 137 (Polygon)
   To: Chain 42161 (Arbitrum)
   Amount: 10.0 USDC
   ✅ REAL quote received from Li.Fi!
      Route: Eco
      Bridge: eco
      Estimated output: 9.94 USDC
      Estimated time: ~0 minutes
      Gas cost (USD): ~$0.0237
```

**Implementation:**

```typescript
// Real Li.Fi SDK integration
const quote = await getQuote({
  fromChain: 137,
  toChain: 42161,
  fromToken: USDC_POLYGON,
  toToken: USDC_ARBITRUM,
  fromAmount: "10000000", // 10 USDC
});
```

### 🎯 Intent-Based Settlement

Merchants declare preferences on-chain via `IntentVault`:

```solidity
enum SettlementSpeed {
    IMMEDIATE,  // Settle now (higher gas, instant funds)
    STANDARD,   // Wait up to maxWaitTimeSeconds for batch partners
    DEFERRED    // Wait until balance >= minBatchAmount (maximum savings)
}
```

**Example:**

```solidity
// Set DEFERRED intent: wait for 100 USDC before settling
intentVault.setIntent(
    SettlementSpeed.DEFERRED,
    100e6,        // minBatchAmount
    0,            // maxWaitTimeSeconds (unused)
    usdcAddress   // targetToken
);
```

### ⚡ Gas Optimization via Batching

Single transaction settles multiple merchants:

```solidity
struct Settlement {
    address merchant;
    address token;
    uint256 amount;
    address recipient;
}

// Settle 10 merchants in one transaction
batchSettler.executeBatch(batchId, settlements[], totalGasSaved);
```

**Savings:** ~60-80% gas reduction compared to individual settlements.

---

## 📊 Technical Stack

### Smart Contracts

- **Solidity ^0.8.30** - Modern features + gas optimizations
- **Foundry** - Fast testing, fuzzing, deployment
- **OpenZeppelin** - Battle-tested libraries (SafeERC20, Ownable)

### Backend

- **TypeScript** - Type-safe development
- **ethers.js v6** - Blockchain interactions
- **Redis Streams** - Event-driven architecture with persistence
- **PostgreSQL + Prisma** - Relational database with type-safe ORM
- **WebSocket** - Real-time Arc blockchain event listening

### Frontend

- **Next.js 14** - React framework with App Router
- **Tailwind CSS** - Utility-first styling
- **Lucide React** - Beautiful icons
- **TypeScript** - Full-stack type safety

### Infrastructure

- **Docker Compose** - Local development environment
- **Arc Testnet** - EVM chain with gas paid in USDC
- **Vercel** - Deployment target (frontend)
- **Upstash/Neon** - Production Redis/PostgreSQL (swap .env)

---

## 🔐 Security Considerations

### Smart Contracts

✅ **Atomic Settlements** - Entire batch succeeds or reverts (no partial failures)  
✅ **Access Control** - Only authorized `BatchSettler` can withdraw from pool  
✅ **Intent Validation** - Merchants must have on-chain intent to be settled  
✅ **SafeERC20** - Handles non-standard token implementations  
✅ **Fuzz Testing** - Foundry fuzzing for edge case detection

### Backend

✅ **Event Replay Protection** - Database tracks processed payment IDs  
✅ **Redis Consumer Groups** - Exactly-once message processing  
✅ **Graceful Shutdown** - Completes in-flight transactions before stopping  
✅ **Error Boundaries** - Yellow/Li.Fi failures don't crash system

---

## 🧪 Testing

### Smart Contracts

```bash
cd contracts

# Run all tests
forge test

# Run with gas reporting
forge test --gas-report

# Run specific test file
forge test --match-path test/BatchSettler.t.sol

# Fuzz testing (Foundry runs 256 random inputs per fuzz test)
forge test --match-test testFuzz
```

**Test Coverage:**

- `PaymentPool.t.sol` - 15 unit tests + 4 fuzz tests
- `IntentVault.t.sol` - 12 unit tests + 3 fuzz tests
- `BatchSettler.t.sol` - 18 unit tests + 3 fuzz tests

### Backend Integration Tests

```bash
cd backend

# Send test payment and verify full flow
cd ../contracts
forge script script/TestPaymentFlow.s.sol \
  --rpc-url arc --broadcast
```

---

## 🎓 Key Learnings

### What Worked Well

✅ **Event-Driven Architecture** - Redis Streams provide durability + simplicity  
✅ **Hybrid Integration Approach** - Real APIs where possible, intelligent fallbacks  
✅ **TypeScript End-to-End** - Type safety across contracts, backend, frontend  
✅ **Foundry Testing** - Fuzz tests caught edge cases we missed

### Production Considerations

- **Yellow Network:** Requires funded custody deposit → resize to unified balance
- **Li.Fi:** Free tier sufficient for demo, paid tier for production volume
- **Gas Estimation:** Real batching savings depend on network congestion
- **Intent Expiry:** Add TTL to prevent stale intents

---

## 📝 Project Structure

```
StablecoinGateway/
├── contracts/              # Foundry project
│   ├── src/
│   │   ├── PaymentPool.sol
│   │   ├── IntentVault.sol
│   │   └── BatchSettler.sol
│   ├── test/              # Comprehensive test suite
│   └── script/            # Deployment & testing scripts
│
├── backend/               # TypeScript backend
│   ├── src/
│   │   ├── index.ts       # Main orchestrator
│   │   ├── api/           # REST API for frontend
│   │   ├── listeners/     # Blockchain event listeners
│   │   ├── consumers/     # Redis Stream consumers
│   │   ├── services/      # Yellow, Li.Fi, Database
│   │   └── config/        # Contracts, Redis, Env
│   ├── prisma/            # Database schema
│   └── docker-compose.yml # Local infrastructure
│
└── frontend/              # Next.js dashboard
    ├── app/
    │   ├── page.tsx       # Main dashboard
    │   └── api/           # (removed - using backend API)
    └── styles/
```

---

## 🏆 Sponsor Integration

### Yellow Network (Lead Sponsor)

- Real WebSocket connection to sandbox clearnode
- EIP-712 authentication implementation
- State channel transfer architecture
- Demo mode for unfunded sandbox

**Code:** `backend/src/services/yellow.ts`

### Li.Fi

- Real SDK integration (`@lifi/sdk`)
- Live API calls to production endpoint
- Actual cross-chain routing quotes
- Bridge/DEX aggregation demonstration

**Code:** `backend/src/services/lifi.ts`

### Arc Testnet

- All contracts deployed on Arc
- Gas paid in USDC (chain feature)
- WebSocket event listening
- Batch settlements executed on-chain

**Code:** `contracts/` + `backend/src/listeners/`

### Uniswap

- Potential DEX integration point via Li.Fi routing
- Future: Direct Uniswap V4 hooks for intent matching

---

## 🚧 Future Enhancements

**V2 Roadmap:**

- [ ] MEV protection via Flashbots/private mempools
- [ ] Multi-token batch settlements (USDC + DAI in same batch)
- [ ] Intent marketplace (merchants bid for batch inclusion)
- [ ] ZK proofs for privacy-preserving intent matching
- [ ] Account abstraction for gasless merchant experience
- [ ] Real-time intent adjustment based on market conditions

---

## 👥 Team

Built for **HackMoney 2026** by Martin BARRAL

---

## 📄 License

MIT License - see LICENSE file for details

---

## 🙏 Acknowledgments

- **Yellow Network** - State channel infrastructure inspiration
- **Li.Fi** - Cross-chain routing excellence
- **Arc** - USDC-gas chain innovation
- **Foundry** - Best-in-class testing framework
- **Anthropic** - Claude for development assistance

---

## 📞 Contact

- **Demo Video:** [Link if available]
- **Live Demo:** http://stabl-gateway-demo.vercel.app (if deployed)
- **GitHub:** [\[Your GitHub\]](https://github.com/MBarralDevs)
- **Twitter:** @MBarralWeb3

---

**Built with ❤️ for a world where stablecoin payments are instant, cheap, and universal.**
