// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "../src/PaymentPool.sol";
import "../src/IntentVault.sol";
import "../src/BatchSettler.sol";

/**
 * @title Deploy
 * @notice Deploys all three core contracts to Arc Testnet and wires them together.
 *
 * @dev Usage:
 *      forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_TESTNET_RPC_URL \
 *          --private-key $PRIVATE_KEY --broadcast -vvvv
 *
 * @dev The script will:
 *      1. Deploy PaymentPool
 *      2. Deploy IntentVault
 *      3. Deploy BatchSettler (passing in Pool and Vault addresses)
 *      4. Register BatchSettler as authorized withdrawer on PaymentPool
 *      5. Print all deployed addresses
 *
 * @dev IMPORTANT: Save the output addresses! The backend needs them.
 */
contract Deploy is Script {
    function run() external {
        // The private key from .env — this address will be the owner of all contracts
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        // ─── Step 1: Deploy PaymentPool ──────────────────────────────────────
        console.log("Deploying PaymentPool...");
        PaymentPool pool = new PaymentPool();
        console.log("PaymentPool deployed at:", address(pool));

        // ─── Step 2: Deploy IntentVault ──────────────────────────────────────
        console.log("Deploying IntentVault...");
        IntentVault vault = new IntentVault();
        console.log("IntentVault deployed at:", address(vault));

        // ─── Step 3: Deploy BatchSettler ─────────────────────────────────────
        console.log("Deploying BatchSettler...");
        BatchSettler settler = new BatchSettler(address(pool), address(vault));
        console.log("BatchSettler deployed at:", address(settler));

        // ─── Step 4: Wire contracts together ─────────────────────────────────
        console.log("Registering BatchSettler as authorized withdrawer...");
        pool.setAuthorizedWithdrawer(address(settler), true);
        console.log("BatchSettler authorized.");

        vm.stopBroadcast();

        // ─── Summary ─────────────────────────────────────────────────────────
        console.log("\n=== DEPLOYMENT COMPLETE ===");
        console.log("PaymentPool:  ", address(pool));
        console.log("IntentVault:  ", address(vault));
        console.log("BatchSettler: ", address(settler));
        console.log("\nCopy these addresses to your backend config!");
    }
}
