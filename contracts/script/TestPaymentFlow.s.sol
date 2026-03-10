// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Test} from "forge-std/Test.sol";
import {PaymentPool} from "../src/PaymentPool.sol";
import {IntentVault} from "../src/IntentVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title TestPaymentFlow
 * @notice Sends a test payment through the full StabL pipeline.
 *
 * @dev Works on both Anvil (local fork) and Arc testnet.
 *      On Anvil: auto-funds the account with USDC via deal()
 *      On testnet: requires pre-funded account (use Arc faucet)
 *
 * @dev Usage (Anvil):
 *      forge script script/TestPaymentFlow.s.sol:TestPaymentFlow \
 *          --rpc-url http://localhost:8545 \
 *          --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
 *          --broadcast -vvvv
 *
 * @dev Usage (Arc testnet):
 *      forge script script/TestPaymentFlow.s.sol:TestPaymentFlow \
 *          --rpc-url $ARC_RPC_URL \
 *          --private-key $DEPLOYER_PRIVATE_KEY \
 *          --broadcast -vvvv
 */
contract TestPaymentFlow is Script, Test {
    // Arc testnet USDC
    IERC20 constant usdc = IERC20(0x4c20Ca8BF703fe85447954Af3EF0E3eCf16dEdb5);

    function run() external {
        // ─── Load addresses from environment ─────────────────────────────
        address poolAddr = vm.envAddress("PAYMENT_POOL_ADDRESS");
        address vaultAddr = vm.envAddress("INTENT_VAULT_ADDRESS");

        PaymentPool paymentPool = PaymentPool(poolAddr);
        IntentVault intentVault = IntentVault(vaultAddr);

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=================================================");
        console.log("StabL Gateway - Payment Flow Test");
        console.log("=================================================");
        console.log("");
        console.log("Deployer:", deployer);
        console.log("PaymentPool:", poolAddr);
        console.log("IntentVault:", vaultAddr);
        console.log("");

        // ─── Step 0: Fund account if on Anvil ────────────────────────────
        // Anvil's default RPC runs on localhost:8545 with chainId 5042002 (forked).
        // We detect Anvil by checking if deployer is the well-known Anvil account #0.
        // On real testnet, this block is skipped entirely.

        bool isAnvil = deployer == 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

        if (isAnvil) {
            console.log("[Anvil] Detected local fork : funding account...");
            deal(address(usdc), deployer, 10_000e6); // 10,000 USDC
            vm.deal(deployer, 100 ether);
            console.log("[Anvil] Funded: 10,000 USDC + 100 ETH");
            console.log("");
        }

        // ─── Step 1: Check USDC balance ──────────────────────────────────

        uint256 balance = usdc.balanceOf(deployer);
        console.log("Step 1: Check USDC balance");
        console.log("  USDC balance:", balance / 1e6, "USDC");

        if (balance < 10e6) {
            console.log("  ERROR: Insufficient USDC.");
            if (!isAnvil) {
                console.log("  Get testnet USDC from the Arc faucet.");
            }
            return;
        }
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ─── Step 2: Set merchant intent (IMMEDIATE) ─────────────────────

        console.log("Step 2: Setting merchant intent");

        IntentVault.MerchantIntent memory intent = intentVault.getIntent(deployer);

        if (intent.exists) {
            string memory speedStr = intent.speed == IntentVault.SettlementSpeed.IMMEDIATE
                ? "IMMEDIATE"
                : intent.speed == IntentVault.SettlementSpeed.STANDARD ? "STANDARD" : "DEFERRED";
            console.log("  Intent already set:", speedStr);
        } else {
            intentVault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, address(usdc));
            console.log("  Intent set: IMMEDIATE");
        }
        console.log("");

        // ─── Step 3: Approve USDC ────────────────────────────────────────

        uint256 paymentAmount = 10e6; // 10 USDC
        usdc.approve(address(paymentPool), paymentAmount);
        console.log("Step 3: Approved", paymentAmount / 1e6, "USDC to PaymentPool");
        console.log("");

        // ─── Step 4: Send payment ────────────────────────────────────────

        bytes32 paymentId = keccak256(abi.encodePacked(block.timestamp, deployer, paymentAmount));

        paymentPool.receivePayment(deployer, address(usdc), paymentAmount, paymentId);

        console.log("Step 4: Payment sent!");
        console.log("  Amount:", paymentAmount / 1e6, "USDC");
        console.log("  Payment ID:", uint256(paymentId));
        console.log("");

        // ─── Step 5: Verify payment in pool ──────────────────────────────

        uint256 poolBalance = paymentPool.getMerchantBalance(deployer, address(usdc));
        console.log("Step 5: Verify");
        console.log("  Merchant balance in PaymentPool:", poolBalance / 1e6, "USDC");
        console.log("");

        vm.stopBroadcast();

        // ─── What to watch for ───────────────────────────────────────────

        console.log("=================================================");
        console.log("NOW WATCH THE BACKEND TERMINAL!");
        console.log("=================================================");
        console.log("");
        console.log("You should see:");
        console.log("  1. PaymentReceived event detected");
        console.log("  2. Payment written to database");
        console.log("  3. Intent check: IMMEDIATE -> settle now");
        console.log("  4. Batch settlement executed on-chain");
        console.log("");
        console.log("After settlement, the merchant balance in");
        console.log("PaymentPool should return to 0.");
        console.log("=================================================");
    }
}
