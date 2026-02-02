// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../src/IntentVault.sol";

contract IntentVaultTest is Test {
    // ─── Contracts ───────────────────────────────────────────────────────────
    IntentVault vault;

    // ─── Actors ──────────────────────────────────────────────────────────────
    address owner;
    address merchant1;
    address merchant2;

    // ─── Token addresses (just need to be non-zero for tests) ───────────────
    address USDC = address(0xA);
    address EURC = address(0xB);

    // ─── Setup ───────────────────────────────────────────────────────────────
    function setUp() public {
        owner = address(0x01);
        merchant1 = address(0x02);
        merchant2 = address(0x03);

        vm.prank(owner);
        vault = new IntentVault();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UNIT TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── setIntent ───────────────────────────────────────────────────────────

    /// @notice Merchant sets IMMEDIATE intent — reads back correctly.
    function test_setIntent_immediate() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        IntentVault.MerchantIntent memory intent = vault.getIntent(merchant1);
        assertEq(uint256(intent.speed), uint256(IntentVault.SettlementSpeed.IMMEDIATE));
        assertEq(intent.targetToken, USDC);
        assertTrue(intent.exists);
    }

    /// @notice Merchant sets STANDARD intent with a wait time.
    function test_setIntent_standard() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.STANDARD, 0, 3600, USDC); // 1 hour wait

        IntentVault.MerchantIntent memory intent = vault.getIntent(merchant1);
        assertEq(uint256(intent.speed), uint256(IntentVault.SettlementSpeed.STANDARD));
        assertEq(intent.maxWaitTimeSeconds, 3600);
        assertTrue(intent.exists);
    }

    /// @notice Merchant sets DEFERRED intent with a batch threshold.
    function test_setIntent_deferred() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, 1000e6, 0, EURC); // 1000 EURC threshold

        IntentVault.MerchantIntent memory intent = vault.getIntent(merchant1);
        assertEq(uint256(intent.speed), uint256(IntentVault.SettlementSpeed.DEFERRED));
        assertEq(intent.minBatchAmount, 1000e6);
        assertEq(intent.targetToken, EURC);
    }

    /// @notice Updating an intent overwrites the previous one completely.
    function test_setIntent_update_overwrites() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        // Update to DEFERRED
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, 500e6, 0, EURC);

        IntentVault.MerchantIntent memory intent = vault.getIntent(merchant1);
        assertEq(uint256(intent.speed), uint256(IntentVault.SettlementSpeed.DEFERRED));
        assertEq(intent.minBatchAmount, 500e6);
        assertEq(intent.targetToken, EURC);
    }

    /// @notice Two merchants have independent intents.
    function test_setIntent_twoMerchants_isolated() public {
        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.IMMEDIATE, 0, 0, USDC);

        vm.prank(merchant2);
        vault.setIntent(IntentVault.SettlementSpeed.DEFERRED, 2000e6, 0, EURC);

        IntentVault.MerchantIntent memory i1 = vault.getIntent(merchant1);
        IntentVault.MerchantIntent memory i2 = vault.getIntent(merchant2);

        assertEq(uint256(i1.speed), uint256(IntentVault.SettlementSpeed.IMMEDIATE));
        assertEq(uint256(i2.speed), uint256(IntentVault.SettlementSpeed.DEFERRED));
        assertEq(i1.targetToken, USDC);
        assertEq(i2.targetToken, EURC);
    }

    /// @notice IntentUpdated event is emitted with correct params.
    function test_setIntent_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit IntentVault.IntentUpdated(merchant1, IntentVault.SettlementSpeed.STANDARD, 0, 7200, USDC);

        vm.prank(merchant1);
        vault.setIntent(IntentVault.SettlementSpeed.STANDARD, 0, 7200, USDC);
    }
}
