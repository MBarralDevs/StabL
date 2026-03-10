// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {PaymentPool} from "../src/PaymentPool.sol";
import {IntentVault} from "../src/IntentVault.sol";
import {BatchSettler} from "../src/BatchSettler.sol";
import {CCTPReceiver} from "../src/CCTPReceiver.sol";

/**
 * @title Deploy
 * @notice Deploys all StabL contracts and configures them.
 *
 * @dev Usage (Anvil local):
 *      anvil --fork-url https://rpc.testnet.arc.network --chain-id 5042002
 *      forge script script/Deploy.s.sol:Deploy --rpc-url http://localhost:8545 \
 *          --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
 *          --broadcast -vvvv
 *
 * @dev Arc Testnet:
 *      forge script script/Deploy.s.sol:Deploy --rpc-url $ARC_RPC_URL \
 *          --private-key $PRIVATE_KEY --broadcast -vvvv
 *
 * @dev The script will:
 *      1. Deploy PaymentPool
 *      2. Deploy IntentVault
 *      3. Deploy BatchSettler (linked to Pool and Vault)
 *      4. Deploy CCTPReceiver (linked to Pool and MessageTransmitter)
 *      5. Wire contracts (authorized withdrawers, token whitelist, CCTP domains)
 *      6. Verify all wiring is correct
 */
contract Deploy is Script {
    // ─── Arc Testnet Token Addresses ─────────────────────────────────────────
    address constant ARC_USDC = 0x4c20Ca8BF703fe85447954Af3EF0E3eCf16dEdb5;
    address constant ARC_EURC = 0x89B5c243b6ebF1a2f615bD8a75B7C1F44c4063A2;

    // ─── Arc CCTP V2 Contract Addresses ──────────────────────────────────────
    address constant ARC_MESSAGE_TRANSMITTER_V2 = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;

    // ─── CCTP Domain IDs (from Circle docs) ──────────────────────────────────
    uint32 constant DOMAIN_ETHEREUM = 0;
    uint32 constant DOMAIN_BASE = 6;
    uint32 constant DOMAIN_ARC = 26;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=== StabL Gateway Deployment ===");
        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // ─── Step 1: Deploy PaymentPool ──────────────────────────────────
        console.log("Step 1/8: Deploying PaymentPool...");
        PaymentPool pool = new PaymentPool();
        console.log("  PaymentPool:", address(pool));

        // ─── Step 2: Deploy IntentVault ──────────────────────────────────
        console.log("Step 2/8: Deploying IntentVault...");
        IntentVault vault = new IntentVault();
        console.log("  IntentVault:", address(vault));

        // ─── Step 3: Deploy BatchSettler ─────────────────────────────────
        console.log("Step 3/8: Deploying BatchSettler...");
        BatchSettler settler = new BatchSettler(address(pool), address(vault), address(0));
        console.log("  BatchSettler:", address(settler));

        // ─── Step 4: Deploy CCTPReceiver ─────────────────────────────────
        console.log("Step 4/8: Deploying CCTPReceiver...");
        CCTPReceiver cctpReceiver = new CCTPReceiver(address(pool), deployer);
        console.log("  CCTPReceiver:", address(cctpReceiver));

        // ─── Step 5: Wire BatchSettler ───────────────────────────────────
        console.log("Step 5/8: Wiring BatchSettler...");
        pool.setAuthorizedWithdrawer(address(settler), true);
        console.log("  BatchSettler authorized as withdrawer");

        // ─── Step 6: Wire CCTPReceiver ───────────────────────────────────
        console.log("Step 6/8: Wiring CCTPReceiver...");
        pool.setAuthorizedWithdrawer(address(cctpReceiver), true);
        console.log("  CCTPReceiver authorized as withdrawer");

        // Enable source domains
        cctpReceiver.setSupportedDomain(DOMAIN_ETHEREUM, true);
        console.log("  Ethereum (domain 0) enabled");
        cctpReceiver.setSupportedDomain(DOMAIN_BASE, true);
        console.log("  Base (domain 6) enabled");

        // ─── Step 7: Whitelist tokens ────────────────────────────────────
        console.log("Step 7/8: Whitelisting tokens...");
        pool.setTokenSupport(ARC_USDC, true);
        console.log("  USDC whitelisted:", ARC_USDC);
        pool.setTokenSupport(ARC_EURC, true);
        console.log("  EURC whitelisted:", ARC_EURC);

        vm.stopBroadcast();

        // ─── Step 8: Verify deployment ───────────────────────────────────
        console.log("Step 8/8: Verifying deployment...");

        // Ownership
        require(pool.owner() == deployer, "PaymentPool owner mismatch");
        require(vault.owner() == deployer, "IntentVault owner mismatch");
        require(settler.owner() == deployer, "BatchSettler owner mismatch");
        require(cctpReceiver.owner() == deployer, "CCTPReceiver owner mismatch");

        // Token whitelist
        require(pool.isTokenSupported(ARC_USDC), "USDC not whitelisted");
        require(pool.isTokenSupported(ARC_EURC), "EURC not whitelisted");

        // Authorized withdrawers
        require(pool.authorizedWithdrawers(address(settler)), "BatchSettler not authorized");
        require(pool.authorizedWithdrawers(address(cctpReceiver)), "CCTPReceiver not authorized");

        // BatchSettler config
        require(settler.maxBatchSize() == 50, "Unexpected maxBatchSize");
        require(settler.feeBasisPoints() == 0, "Fees should be disabled");

        // CCTPReceiver config
        require(cctpReceiver.supportedDomains(DOMAIN_ETHEREUM), "Ethereum domain not supported");
        require(cctpReceiver.supportedDomains(DOMAIN_BASE), "Base domain not supported");

        console.log("  All checks passed!");

        // ─── Summary ─────────────────────────────────────────────────────
        console.log("");
        console.log("=== DEPLOYMENT COMPLETE ===");
        console.log("");
        console.log("PaymentPool:   ", address(pool));
        console.log("IntentVault:   ", address(vault));
        console.log("BatchSettler:  ", address(settler));
        console.log("CCTPReceiver:  ", address(cctpReceiver));
        console.log("");
        console.log("USDC:          ", ARC_USDC);
        console.log("EURC:          ", ARC_EURC);
        console.log("MessageTransmitterV2:", ARC_MESSAGE_TRANSMITTER_V2);
        console.log("");
        console.log("CCTP Domains:  Ethereum (0), Base (6)");
        console.log("Max batch size: 50");
        console.log("Fees:           disabled");
        console.log("");
        console.log("Copy these to backend/.env:");
        console.log("  PAYMENT_POOL_ADDRESS=", address(pool));
        console.log("  INTENT_VAULT_ADDRESS=", address(vault));
        console.log("  BATCH_SETTLER_ADDRESS=", address(settler));
        console.log("  CCTP_RECEIVER_ADDRESS=", address(cctpReceiver));
    }
}
