// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PaymentPool} from "../src/PaymentPool.sol";
import {IntentVault} from "../src/IntentVault.sol";
import {BatchSettler} from "../src/BatchSettler.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TestPaymentFlow is Script {
    // Contract addresses (from your .env)
    PaymentPool paymentPool = PaymentPool(0x5a100C9c5B7586cf014ACd65A7EEd592589bc3c4);
    IntentVault intentVault = IntentVault(0xCb3016AaeAF3C956960134aF241468701D68E1C4);
    BatchSettler batchSettler = BatchSettler(0x33A7aE97Cf4ee8747Fde9B13e096A86500F4C6E7);

    // Arc testnet USDC
    IERC20 usdc = IERC20(0x4c20Ca8BF703fe85447954Af3EF0E3eCf16dEdb5);

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=================================================");
        console.log("StabL Gateway - Payment Flow Test");
        console.log("=================================================");
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ─── Step 1: Check USDC balance ─────────────────────────────────

        uint256 balance = usdc.balanceOf(deployer);
        console.log("Step 1: Check USDC balance");
        console.log("  Your address:", deployer);
        console.log("  USDC balance:", balance / 1e6, "USDC");
        console.log("");

        if (balance < 10e6) {
            console.log("ERROR: Insufficient USDC balance");
            console.log("Please get testnet USDC from Arc faucet");
            console.log("Then run this script again");
            vm.stopBroadcast();
            return;
        }

        // ─── Step 2: Set merchant intent (IMMEDIATE) ────────────────────

        console.log("Step 2: Setting merchant intent");
        console.log("  Merchant:", deployer);
        console.log("  Intent: IMMEDIATE settlement");
        console.log("");

        // Check if intent already exists
        IntentVault.MerchantIntent memory intent = intentVault.getIntent(deployer);

        if (intent.exists) {
            console.log("  Intent already set:");
            string memory speedStr = intent.speed == IntentVault.SettlementSpeed.IMMEDIATE
                ? "IMMEDIATE"
                : intent.speed == IntentVault.SettlementSpeed.STANDARD ? "STANDARD" : "DEFERRED";
            console.log("    Speed:", speedStr);
        } else {
            // Set IMMEDIATE intent
            intentVault.setIntent(
                IntentVault.SettlementSpeed.IMMEDIATE,
                0, // minBatchAmount (0 for IMMEDIATE)
                0, // maxWaitTimeSeconds (0 for IMMEDIATE)
                address(usdc) // targetToken
            );
            console.log("  Intent set successfully!");
        }
        console.log("");

        // ─── Step 3: Approve PaymentPool to spend USDC ─────────────────

        console.log("Step 3: Approving USDC");
        uint256 paymentAmount = 10e6; // 10 USDC

        usdc.approve(address(paymentPool), paymentAmount);
        console.log("  Approved", paymentAmount / 1e6, "USDC to PaymentPool");
        console.log("");

        // ─── Step 4: Send payment to PaymentPool ───────────────────────

        console.log("Step 4: Sending payment");
        console.log("  Amount:", paymentAmount / 1e6, "USDC");
        console.log("");

        // Convert timestamp to bytes32 for paymentId
        bytes32 paymentId = bytes32(block.timestamp);

        paymentPool.receivePayment(
            deployer, // merchant (yourself for testing)
            address(usdc), // token
            paymentAmount, // amount
            paymentId // paymentId (bytes32)
        );

        console.log("  Payment sent successfully!");
        console.log("  Payment ID:", uint256(paymentId));
        console.log("");

        // ─── Step 5: Check merchant balance in PaymentPool ─────────────

        uint256 poolBalance = paymentPool.getMerchantBalance(deployer, address(usdc));
        console.log("Step 5: Verify payment received");
        console.log("  Merchant balance in PaymentPool:", poolBalance / 1e6, "USDC");
        console.log("");

        vm.stopBroadcast();

        // ─── Instructions for next steps ───────────────────────────────

        console.log("=================================================");
        console.log("NEXT STEPS:");
        console.log("=================================================");
        console.log("");
        console.log("1. Check your backend terminal");
        console.log("   You should see the payment processing flow:");
        console.log("   - PaymentReceived event detected");
        console.log("   - Payment processor (Yellow credit + DB write)");
        console.log("   - Intent checker (threshold check)");
        console.log("   - Batch executor (on-chain settlement)");
        console.log("");
        console.log("2. Wait ~5-10 seconds for settlement");
        console.log("");
        console.log("3. Verify settlement completed:");
        console.log("   Run: forge script script/VerifySettlement.s.sol --rpc-url arc");
        console.log("");
        console.log("Your merchant address:", deployer);
        console.log("=================================================");
    }
}
