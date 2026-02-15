// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {PaymentPool} from "../src/PaymentPool.sol";
import {IntentVault} from "../src/IntentVault.sol";
import {BatchSettler} from "../src/BatchSettler.sol";

/**
 * @title Deploy
 * @notice Deploys all three core contracts and configures them for production.
 *
 * @dev Usage:
 *      forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_RPC_URL \
 *          --private-key $PRIVATE_KEY --broadcast -vvvv
 *
 * @dev The script will:
 *      1. Deploy PaymentPool
 *      2. Deploy IntentVault
 *      3. Deploy BatchSettler (linked to Pool and Vault)
 *      4. Register BatchSettler as authorized withdrawer on PaymentPool
 *      5. Whitelist supported tokens (USDC, EURC) on PaymentPool
 *      6. Verify all wiring is correct
 */
contract Deploy is Script {
    // Arc Testnet token addresses
    address constant ARC_USDC = 0x4c20Ca8BF703fe85447954Af3EF0E3eCf16dEdb5;
    address constant ARC_EURC = 0x89B5c243b6ebF1a2f615bD8a75B7C1F44c4063A2;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== StabL Gateway Deployment ===");
        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ─── Step 1: Deploy PaymentPool ──────────────────────────────────
        console.log("Step 1/6: Deploying PaymentPool...");
        PaymentPool pool = new PaymentPool();
        console.log("  PaymentPool:", address(pool));

        // ─── Step 2: Deploy IntentVault ──────────────────────────────────
        console.log("Step 2/6: Deploying IntentVault...");
        IntentVault vault = new IntentVault();
        console.log("  IntentVault:", address(vault));

        // ─── Step 3: Deploy BatchSettler ─────────────────────────────────
        console.log("Step 3/6: Deploying BatchSettler...");
        BatchSettler settler = new BatchSettler(address(pool), address(vault));
        console.log("  BatchSettler:", address(settler));

        // ─── Step 4: Wire contracts ──────────────────────────────────────
        console.log("Step 4/6: Wiring contracts...");
        pool.setAuthorizedWithdrawer(address(settler), true);
        console.log("  BatchSettler authorized as withdrawer");

        // ─── Step 5: Whitelist tokens ────────────────────────────────────
        console.log("Step 5/6: Whitelisting tokens...");
        pool.setTokenSupport(ARC_USDC, true);
        console.log("  USDC whitelisted:", ARC_USDC);
        pool.setTokenSupport(ARC_EURC, true);
        console.log("  EURC whitelisted:", ARC_EURC);

        vm.stopBroadcast();

        // ─── Step 6: Verify deployment ───────────────────────────────────
        console.log("Step 6/6: Verifying deployment...");

        require(pool.owner() == deployer, "PaymentPool owner mismatch");
        require(vault.owner() == deployer, "IntentVault owner mismatch");
        require(settler.owner() == deployer, "BatchSettler owner mismatch");
        require(pool.isTokenSupported(ARC_USDC), "USDC not whitelisted");
        require(pool.isTokenSupported(ARC_EURC), "EURC not whitelisted");
        require(settler.maxBatchSize() == 50, "Unexpected maxBatchSize");
        require(settler.feeBasisPoints() == 0, "Fees should be disabled at deploy");

        console.log("  All checks passed!");

        // ─── Summary ─────────────────────────────────────────────────────
        console.log("");
        console.log("=== DEPLOYMENT COMPLETE ===");
        console.log("");
        console.log("PaymentPool:  ", address(pool));
        console.log("IntentVault:  ", address(vault));
        console.log("BatchSettler: ", address(settler));
        console.log("");
        console.log("USDC:         ", ARC_USDC);
        console.log("EURC:         ", ARC_EURC);
        console.log("");
        console.log("Max batch size: 50");
        console.log("Fees:           disabled (set with setFeeConfig)");
        console.log("");
        console.log("Copy these addresses to backend/.env:");
        console.log("  PAYMENT_POOL_ADDRESS=", address(pool));
        console.log("  INTENT_VAULT_ADDRESS=", address(vault));
        console.log("  BATCH_SETTLER_ADDRESS=", address(settler));
    }
}
