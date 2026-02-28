// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CCTPReceiver} from "../src/CCTPReceiver.sol";
import {PaymentPool} from "../src/PaymentPool.sol";
import {IntentVault} from "../src/IntentVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─── Mock Token ─────────────────────────────────────────────────────────────
contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract CCTPReceiverTest is Test {
    // ─── Contracts ───────────────────────────────────────────────────────
    CCTPReceiver public receiver;
    PaymentPool public pool;
    IntentVault public vault;
    MockERC20 public usdc;
    MockERC20 public eurc;

    // ─── Actors ──────────────────────────────────────────────────────────
    address public owner;
    address public relayer;
    address public relayer2;
    address public merchant1;
    address public merchant2;
    address public unauthorized;

    // ─── CCTP Domain Constants ───────────────────────────────────────────
    uint32 constant DOMAIN_ETHEREUM = 0;
    uint32 constant DOMAIN_AVALANCHE = 1;
    uint32 constant DOMAIN_BASE = 6;
    uint32 constant DOMAIN_UNSUPPORTED = 99;

    // ─── Setup ───────────────────────────────────────────────────────────
    function setUp() public {
        owner = address(0x01);
        relayer = address(0x02);
        relayer2 = address(0x03);
        merchant1 = address(0x10);
        merchant2 = address(0x11);
        unauthorized = address(0x99);

        // Deploy tokens
        usdc = new MockERC20("USD Coin", "USDC");
        eurc = new MockERC20("Euro Coin", "EURC");

        // Deploy PaymentPool and IntentVault (needed by PaymentPool flow)
        vm.startPrank(owner);
        pool = new PaymentPool();
        vault = new IntentVault();
        vm.stopPrank();

        // Whitelist tokens on PaymentPool
        vm.startPrank(owner);
        pool.setTokenSupport(address(usdc), true);
        pool.setTokenSupport(address(eurc), true);
        vm.stopPrank();

        // Deploy CCTPReceiver
        vm.prank(owner);
        receiver = new CCTPReceiver(address(pool), owner);

        // Configure CCTPReceiver
        vm.startPrank(owner);
        receiver.setRelayer(relayer, true);
        receiver.setSupportedToken(address(usdc), true);
        receiver.setSupportedToken(address(eurc), true);
        receiver.setSupportedDomain(DOMAIN_ETHEREUM, true);
        receiver.setSupportedDomain(DOMAIN_BASE, true);
        vm.stopPrank();

        // Authorize CCTPReceiver to call receivePayment on PaymentPool
        // (CCTPReceiver calls pool.receivePayment which needs token approval)
        // PaymentPool.receivePayment does transferFrom, so CCTPReceiver needs to approve
    }

    // ─── Helper: Simulate CCTP mint ─────────────────────────────────────
    /// @dev Simulates what happens after MessageTransmitterV2.receiveMessage()
    ///      — USDC is minted directly to the CCTPReceiver contract.
    function _simulateCCTPMint(address token, uint256 amount) internal {
        MockERC20(token).mint(address(receiver), amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    function test_constructor_setsPaymentPool() public view {
        assertEq(address(receiver.paymentPool()), address(pool));
    }

    function test_constructor_setsOwner() public view {
        assertEq(receiver.owner(), owner);
    }

    function test_constructor_revert_zeroPaymentPool() public {
        vm.prank(owner);
        vm.expectRevert(CCTPReceiver.CCTPReceiver__ZeroAddress.selector);
        new CCTPReceiver(address(0), owner);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PROCESS PAYMENT: Happy Path
    // ═══════════════════════════════════════════════════════════════════════════

    function test_processPayment_single() public {
        // Simulate CCTP minting 1000 USDC to receiver
        _simulateCCTPMint(address(usdc), 1000e6);

        bytes32 paymentId = keccak256("cctp-payment-001");

        vm.prank(relayer);
        receiver.processPayment(merchant1, address(usdc), 1000e6, paymentId, DOMAIN_ETHEREUM);

        // Verify: merchant has balance in PaymentPool
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 1000e6);

        // Verify: receiver contract has no remaining balance
        assertEq(usdc.balanceOf(address(receiver)), 0);

        // Verify: payment marked as processed
        assertTrue(receiver.isPaymentProcessed(paymentId));

        // Verify: analytics updated
        assertEq(receiver.totalPaymentsProcessed(), 1);
        assertEq(receiver.totalVolumeByToken(address(usdc)), 1000e6);
        assertEq(receiver.totalVolumeByDomain(DOMAIN_ETHEREUM), 1000e6);
    }

    function test_processPayment_eurc() public {
        _simulateCCTPMint(address(eurc), 500e6);

        bytes32 paymentId = keccak256("cctp-eurc-001");

        vm.prank(relayer);
        receiver.processPayment(merchant1, address(eurc), 500e6, paymentId, DOMAIN_BASE);

        assertEq(pool.getMerchantBalance(merchant1, address(eurc)), 500e6);
        assertEq(eurc.balanceOf(address(receiver)), 0);
        assertEq(receiver.totalVolumeByDomain(DOMAIN_BASE), 500e6);
    }

    function test_processPayment_multipleMerchants() public {
        _simulateCCTPMint(address(usdc), 2500e6);

        vm.startPrank(relayer);
        receiver.processPayment(merchant1, address(usdc), 1000e6, keccak256("p1"), DOMAIN_ETHEREUM);
        receiver.processPayment(merchant2, address(usdc), 1500e6, keccak256("p2"), DOMAIN_ETHEREUM);
        vm.stopPrank();

        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 1000e6);
        assertEq(pool.getMerchantBalance(merchant2, address(usdc)), 1500e6);
        assertEq(usdc.balanceOf(address(receiver)), 0);
        assertEq(receiver.totalPaymentsProcessed(), 2);
    }

    function test_processPayment_partialBalance() public {
        // Mint 2000 but only process 1000 — receiver keeps remaining 1000
        _simulateCCTPMint(address(usdc), 2000e6);

        vm.prank(relayer);
        receiver.processPayment(merchant1, address(usdc), 1000e6, keccak256("p1"), DOMAIN_ETHEREUM);

        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 1000e6);
        assertEq(usdc.balanceOf(address(receiver)), 1000e6);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PROCESS PAYMENT: Events
    // ═══════════════════════════════════════════════════════════════════════════

    function test_processPayment_emitsEvent() public {
        _simulateCCTPMint(address(usdc), 1000e6);
        bytes32 paymentId = keccak256("event-test");

        vm.expectEmit(true, true, false, true);
        emit CCTPReceiver.CrossChainPaymentProcessed(
            paymentId, merchant1, address(usdc), 1000e6, DOMAIN_ETHEREUM, relayer
        );

        vm.prank(relayer);
        receiver.processPayment(merchant1, address(usdc), 1000e6, paymentId, DOMAIN_ETHEREUM);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PROCESS PAYMENT: Reverts
    // ═══════════════════════════════════════════════════════════════════════════

    function test_processPayment_revert_unauthorizedRelayer() public {
        _simulateCCTPMint(address(usdc), 1000e6);

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(CCTPReceiver.CCTPReceiver__UnauthorizedRelayer.selector, unauthorized));
        receiver.processPayment(merchant1, address(usdc), 1000e6, keccak256("p1"), DOMAIN_ETHEREUM);
    }

    function test_processPayment_revert_zeroMerchant() public {
        _simulateCCTPMint(address(usdc), 1000e6);

        vm.prank(relayer);
        vm.expectRevert(CCTPReceiver.CCTPReceiver__ZeroAddress.selector);
        receiver.processPayment(address(0), address(usdc), 1000e6, keccak256("p1"), DOMAIN_ETHEREUM);
    }

    function test_processPayment_revert_zeroAmount() public {
        vm.prank(relayer);
        vm.expectRevert(CCTPReceiver.CCTPReceiver__ZeroAmount.selector);
        receiver.processPayment(merchant1, address(usdc), 0, keccak256("p1"), DOMAIN_ETHEREUM);
    }

    function test_processPayment_revert_unsupportedToken() public {
        MockERC20 dai = new MockERC20("DAI", "DAI");
        dai.mint(address(receiver), 1000e6);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(CCTPReceiver.CCTPReceiver__UnsupportedToken.selector, address(dai)));
        receiver.processPayment(merchant1, address(dai), 1000e6, keccak256("p1"), DOMAIN_ETHEREUM);
    }

    function test_processPayment_revert_unsupportedDomain() public {
        _simulateCCTPMint(address(usdc), 1000e6);

        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(CCTPReceiver.CCTPReceiver__UnsupportedDomain.selector, DOMAIN_UNSUPPORTED)
        );
        receiver.processPayment(merchant1, address(usdc), 1000e6, keccak256("p1"), DOMAIN_UNSUPPORTED);
    }

    function test_processPayment_revert_duplicatePayment() public {
        _simulateCCTPMint(address(usdc), 2000e6);
        bytes32 paymentId = keccak256("duplicate");

        vm.startPrank(relayer);
        receiver.processPayment(merchant1, address(usdc), 1000e6, paymentId, DOMAIN_ETHEREUM);

        vm.expectRevert(abi.encodeWithSelector(CCTPReceiver.CCTPReceiver__DuplicatePayment.selector, paymentId));
        receiver.processPayment(merchant1, address(usdc), 1000e6, paymentId, DOMAIN_ETHEREUM);
        vm.stopPrank();
    }

    function test_processPayment_revert_insufficientBalance() public {
        // Don't mint anything — receiver has 0 balance
        vm.prank(relayer);
        vm.expectRevert(
            abi.encodeWithSelector(CCTPReceiver.CCTPReceiver__InsufficientBalance.selector, address(usdc), 1000e6, 0)
        );
        receiver.processPayment(merchant1, address(usdc), 1000e6, keccak256("p1"), DOMAIN_ETHEREUM);
    }

    function test_processPayment_revert_whenPaused() public {
        _simulateCCTPMint(address(usdc), 1000e6);

        vm.prank(owner);
        receiver.pause();

        vm.prank(relayer);
        vm.expectRevert();
        receiver.processPayment(merchant1, address(usdc), 1000e6, keccak256("p1"), DOMAIN_ETHEREUM);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BATCH PROCESSING
    // ═══════════════════════════════════════════════════════════════════════════

    function test_processPaymentBatch_happy() public {
        _simulateCCTPMint(address(usdc), 3000e6);

        address[] memory merchants = new address[](3);
        merchants[0] = merchant1;
        merchants[1] = merchant2;
        merchants[2] = merchant1;

        address[] memory tokens = new address[](3);
        tokens[0] = address(usdc);
        tokens[1] = address(usdc);
        tokens[2] = address(usdc);

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 1000e6;
        amounts[1] = 1500e6;
        amounts[2] = 500e6;

        bytes32[] memory paymentIds = new bytes32[](3);
        paymentIds[0] = keccak256("batch-1");
        paymentIds[1] = keccak256("batch-2");
        paymentIds[2] = keccak256("batch-3");

        uint32[] memory domains = new uint32[](3);
        domains[0] = DOMAIN_ETHEREUM;
        domains[1] = DOMAIN_BASE;
        domains[2] = DOMAIN_ETHEREUM;

        vm.prank(relayer);
        receiver.processPaymentBatch(merchants, tokens, amounts, paymentIds, domains);

        // merchant1 got 1000 + 500 = 1500
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 1500e6);
        // merchant2 got 1500
        assertEq(pool.getMerchantBalance(merchant2, address(usdc)), 1500e6);
        // Receiver is empty
        assertEq(usdc.balanceOf(address(receiver)), 0);
        // All marked processed
        assertTrue(receiver.isPaymentProcessed(paymentIds[0]));
        assertTrue(receiver.isPaymentProcessed(paymentIds[1]));
        assertTrue(receiver.isPaymentProcessed(paymentIds[2]));
        // Analytics
        assertEq(receiver.totalPaymentsProcessed(), 3);
        assertEq(receiver.totalVolumeByToken(address(usdc)), 3000e6);
        assertEq(receiver.totalVolumeByDomain(DOMAIN_ETHEREUM), 1500e6);
        assertEq(receiver.totalVolumeByDomain(DOMAIN_BASE), 1500e6);
    }

    function test_processPaymentBatch_mixedTokens() public {
        _simulateCCTPMint(address(usdc), 1000e6);
        _simulateCCTPMint(address(eurc), 500e6);

        address[] memory merchants = new address[](2);
        merchants[0] = merchant1;
        merchants[1] = merchant2;

        address[] memory tokens = new address[](2);
        tokens[0] = address(usdc);
        tokens[1] = address(eurc);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1000e6;
        amounts[1] = 500e6;

        bytes32[] memory paymentIds = new bytes32[](2);
        paymentIds[0] = keccak256("mixed-1");
        paymentIds[1] = keccak256("mixed-2");

        uint32[] memory domains = new uint32[](2);
        domains[0] = DOMAIN_ETHEREUM;
        domains[1] = DOMAIN_BASE;

        vm.prank(relayer);
        receiver.processPaymentBatch(merchants, tokens, amounts, paymentIds, domains);

        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 1000e6);
        assertEq(pool.getMerchantBalance(merchant2, address(eurc)), 500e6);
    }

    function test_processPaymentBatch_revert_emptyBatch() public {
        address[] memory merchants = new address[](0);
        address[] memory tokens = new address[](0);
        uint256[] memory amounts = new uint256[](0);
        bytes32[] memory paymentIds = new bytes32[](0);
        uint32[] memory domains = new uint32[](0);

        vm.prank(relayer);
        vm.expectRevert(CCTPReceiver.CCTPReceiver__ZeroAmount.selector);
        receiver.processPaymentBatch(merchants, tokens, amounts, paymentIds, domains);
    }

    function test_processPaymentBatch_revert_arrayLengthMismatch() public {
        address[] memory merchants = new address[](2);
        address[] memory tokens = new address[](1); // mismatch!
        uint256[] memory amounts = new uint256[](2);
        bytes32[] memory paymentIds = new bytes32[](2);
        uint32[] memory domains = new uint32[](2);

        merchants[0] = merchant1;
        merchants[1] = merchant2;

        vm.prank(relayer);
        vm.expectRevert(CCTPReceiver.CCTPReceiver__ZeroAmount.selector);
        receiver.processPaymentBatch(merchants, tokens, amounts, paymentIds, domains);
    }

    function test_processPaymentBatch_revert_unauthorizedRelayer() public {
        address[] memory merchants = new address[](1);
        merchants[0] = merchant1;
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100e6;
        bytes32[] memory paymentIds = new bytes32[](1);
        paymentIds[0] = keccak256("x");
        uint32[] memory domains = new uint32[](1);
        domains[0] = DOMAIN_ETHEREUM;

        vm.prank(unauthorized);
        vm.expectRevert(abi.encodeWithSelector(CCTPReceiver.CCTPReceiver__UnauthorizedRelayer.selector, unauthorized));
        receiver.processPaymentBatch(merchants, tokens, amounts, paymentIds, domains);
    }

    function test_processPaymentBatch_atomicRevert() public {
        // Mint only 1000 USDC — second payment of 1500 should cause revert
        _simulateCCTPMint(address(usdc), 1000e6);

        address[] memory merchants = new address[](2);
        merchants[0] = merchant1;
        merchants[1] = merchant2;

        address[] memory tokens = new address[](2);
        tokens[0] = address(usdc);
        tokens[1] = address(usdc);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1000e6;
        amounts[1] = 1500e6; // Not enough balance after first payment

        bytes32[] memory paymentIds = new bytes32[](2);
        paymentIds[0] = keccak256("atomic-1");
        paymentIds[1] = keccak256("atomic-2");

        uint32[] memory domains = new uint32[](2);
        domains[0] = DOMAIN_ETHEREUM;
        domains[1] = DOMAIN_ETHEREUM;

        vm.prank(relayer);
        vm.expectRevert(); // Second payment will fail — entire batch reverts
        receiver.processPaymentBatch(merchants, tokens, amounts, paymentIds, domains);

        // Nothing processed — atomic revert
        assertFalse(receiver.isPaymentProcessed(paymentIds[0]));
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 0);
        assertEq(usdc.balanceOf(address(receiver)), 1000e6); // Still held
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN: Relayer Management
    // ═══════════════════════════════════════════════════════════════════════════

    function test_setRelayer_authorize() public {
        vm.prank(owner);
        receiver.setRelayer(relayer2, true);
        assertTrue(receiver.authorizedRelayers(relayer2));
    }

    function test_setRelayer_revoke() public {
        vm.startPrank(owner);
        receiver.setRelayer(relayer2, true);
        receiver.setRelayer(relayer2, false);
        vm.stopPrank();
        assertFalse(receiver.authorizedRelayers(relayer2));
    }

    function test_setRelayer_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit CCTPReceiver.RelayerUpdated(relayer2, true);

        vm.prank(owner);
        receiver.setRelayer(relayer2, true);
    }

    function test_setRelayer_revert_notOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        receiver.setRelayer(relayer2, true);
    }

    function test_setRelayer_revert_zeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(CCTPReceiver.CCTPReceiver__ZeroAddress.selector);
        receiver.setRelayer(address(0), true);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN: Token Management
    // ═══════════════════════════════════════════════════════════════════════════

    function test_setSupportedToken() public {
        MockERC20 newToken = new MockERC20("New", "NEW");

        vm.prank(owner);
        receiver.setSupportedToken(address(newToken), true);
        assertTrue(receiver.supportedTokens(address(newToken)));
    }

    function test_setSupportedToken_remove() public {
        vm.prank(owner);
        receiver.setSupportedToken(address(usdc), false);
        assertFalse(receiver.supportedTokens(address(usdc)));
    }

    function test_setSupportedToken_emitsEvent() public {
        MockERC20 newToken = new MockERC20("New", "NEW");

        vm.expectEmit(true, false, false, true);
        emit CCTPReceiver.SupportedTokenUpdated(address(newToken), true);

        vm.prank(owner);
        receiver.setSupportedToken(address(newToken), true);
    }

    function test_setSupportedToken_revert_notOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        receiver.setSupportedToken(address(usdc), false);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN: Domain Management
    // ═══════════════════════════════════════════════════════════════════════════

    function test_setSupportedDomain() public {
        vm.prank(owner);
        receiver.setSupportedDomain(DOMAIN_AVALANCHE, true);
        assertTrue(receiver.supportedDomains(DOMAIN_AVALANCHE));
    }

    function test_setSupportedDomain_remove() public {
        vm.prank(owner);
        receiver.setSupportedDomain(DOMAIN_ETHEREUM, false);
        assertFalse(receiver.supportedDomains(DOMAIN_ETHEREUM));
    }

    function test_setSupportedDomain_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit CCTPReceiver.SupportedDomainUpdated(DOMAIN_AVALANCHE, true);

        vm.prank(owner);
        receiver.setSupportedDomain(DOMAIN_AVALANCHE, true);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN: PaymentPool Update
    // ═══════════════════════════════════════════════════════════════════════════

    function test_setPaymentPool() public {
        vm.prank(owner);
        PaymentPool newPool = new PaymentPool();

        vm.expectEmit(true, true, false, false);
        emit CCTPReceiver.PaymentPoolUpdated(address(pool), address(newPool));

        vm.prank(owner);
        receiver.setPaymentPool(address(newPool));
        assertEq(address(receiver.paymentPool()), address(newPool));
    }

    function test_setPaymentPool_revert_zero() public {
        vm.prank(owner);
        vm.expectRevert(CCTPReceiver.CCTPReceiver__ZeroAddress.selector);
        receiver.setPaymentPool(address(0));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN: Pause / Unpause
    // ═══════════════════════════════════════════════════════════════════════════

    function test_pause_unpause() public {
        vm.prank(owner);
        receiver.pause();

        _simulateCCTPMint(address(usdc), 1000e6);

        // Can't process when paused
        vm.prank(relayer);
        vm.expectRevert();
        receiver.processPayment(merchant1, address(usdc), 1000e6, keccak256("p1"), DOMAIN_ETHEREUM);

        // Unpause
        vm.prank(owner);
        receiver.unpause();

        // Now works
        vm.prank(relayer);
        receiver.processPayment(merchant1, address(usdc), 1000e6, keccak256("p1"), DOMAIN_ETHEREUM);
        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 1000e6);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN: Emergency Sweep
    // ═══════════════════════════════════════════════════════════════════════════

    function test_sweep() public {
        _simulateCCTPMint(address(usdc), 5000e6);

        vm.expectEmit(true, true, false, true);
        emit CCTPReceiver.TokensSwept(address(usdc), owner, 5000e6);

        vm.prank(owner);
        receiver.sweep(address(usdc), owner, 5000e6);

        assertEq(usdc.balanceOf(owner), 5000e6);
        assertEq(usdc.balanceOf(address(receiver)), 0);
    }

    function test_sweep_partial() public {
        _simulateCCTPMint(address(usdc), 5000e6);

        vm.prank(owner);
        receiver.sweep(address(usdc), owner, 2000e6);

        assertEq(usdc.balanceOf(owner), 2000e6);
        assertEq(usdc.balanceOf(address(receiver)), 3000e6);
    }

    function test_sweep_revert_notOwner() public {
        _simulateCCTPMint(address(usdc), 1000e6);

        vm.prank(unauthorized);
        vm.expectRevert();
        receiver.sweep(address(usdc), unauthorized, 1000e6);
    }

    function test_sweep_revert_zeroToken() public {
        vm.prank(owner);
        vm.expectRevert(CCTPReceiver.CCTPReceiver__ZeroAddress.selector);
        receiver.sweep(address(0), owner, 1000e6);
    }

    function test_sweep_revert_zeroRecipient() public {
        vm.prank(owner);
        vm.expectRevert(CCTPReceiver.CCTPReceiver__ZeroAddress.selector);
        receiver.sweep(address(usdc), address(0), 1000e6);
    }

    function test_sweep_revert_zeroAmount() public {
        vm.prank(owner);
        vm.expectRevert(CCTPReceiver.CCTPReceiver__ZeroAmount.selector);
        receiver.sweep(address(usdc), owner, 0);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_getBalance() public {
        assertEq(receiver.getBalance(address(usdc)), 0);

        _simulateCCTPMint(address(usdc), 1234e6);
        assertEq(receiver.getBalance(address(usdc)), 1234e6);
    }

    function test_isPaymentProcessed_false() public view {
        assertFalse(receiver.isPaymentProcessed(keccak256("nonexistent")));
    }

    function test_isPaymentProcessed_true() public {
        _simulateCCTPMint(address(usdc), 100e6);
        bytes32 paymentId = keccak256("check-me");

        vm.prank(relayer);
        receiver.processPayment(merchant1, address(usdc), 100e6, paymentId, DOMAIN_ETHEREUM);

        assertTrue(receiver.isPaymentProcessed(paymentId));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ANALYTICS TRACKING
    // ═══════════════════════════════════════════════════════════════════════════

    function test_analytics_multiDomainMultiToken() public {
        _simulateCCTPMint(address(usdc), 3000e6);
        _simulateCCTPMint(address(eurc), 1000e6);

        vm.startPrank(relayer);
        receiver.processPayment(merchant1, address(usdc), 1000e6, keccak256("a1"), DOMAIN_ETHEREUM);
        receiver.processPayment(merchant1, address(usdc), 2000e6, keccak256("a2"), DOMAIN_BASE);
        receiver.processPayment(merchant2, address(eurc), 1000e6, keccak256("a3"), DOMAIN_ETHEREUM);
        vm.stopPrank();

        assertEq(receiver.totalPaymentsProcessed(), 3);
        assertEq(receiver.totalVolumeByToken(address(usdc)), 3000e6);
        assertEq(receiver.totalVolumeByToken(address(eurc)), 1000e6);
        assertEq(receiver.totalVolumeByDomain(DOMAIN_ETHEREUM), 2000e6);
        assertEq(receiver.totalVolumeByDomain(DOMAIN_BASE), 2000e6);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // EDGE CASES
    // ═══════════════════════════════════════════════════════════════════════════

    /// @notice Revoking a relayer mid-flight prevents further processing
    function test_revokeRelayer_preventsProcessing() public {
        _simulateCCTPMint(address(usdc), 2000e6);

        // First payment works
        vm.prank(relayer);
        receiver.processPayment(merchant1, address(usdc), 1000e6, keccak256("p1"), DOMAIN_ETHEREUM);

        // Revoke relayer
        vm.prank(owner);
        receiver.setRelayer(relayer, false);

        // Second payment fails
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(CCTPReceiver.CCTPReceiver__UnauthorizedRelayer.selector, relayer));
        receiver.processPayment(merchant1, address(usdc), 1000e6, keccak256("p2"), DOMAIN_ETHEREUM);
    }

    /// @notice Removing token support prevents processing
    function test_removeTokenSupport_preventsProcessing() public {
        _simulateCCTPMint(address(usdc), 1000e6);

        vm.prank(owner);
        receiver.setSupportedToken(address(usdc), false);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(CCTPReceiver.CCTPReceiver__UnsupportedToken.selector, address(usdc)));
        receiver.processPayment(merchant1, address(usdc), 1000e6, keccak256("p1"), DOMAIN_ETHEREUM);
    }

    /// @notice Removing domain support prevents processing
    function test_removeDomainSupport_preventsProcessing() public {
        _simulateCCTPMint(address(usdc), 1000e6);

        vm.prank(owner);
        receiver.setSupportedDomain(DOMAIN_ETHEREUM, false);

        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(CCTPReceiver.CCTPReceiver__UnsupportedDomain.selector, DOMAIN_ETHEREUM));
        receiver.processPayment(merchant1, address(usdc), 1000e6, keccak256("p1"), DOMAIN_ETHEREUM);
    }

    /// @notice Same paymentId with different merchants still reverts (global uniqueness)
    function test_duplicatePaymentId_differentMerchant_reverts() public {
        _simulateCCTPMint(address(usdc), 2000e6);
        bytes32 paymentId = keccak256("global-unique");

        vm.startPrank(relayer);
        receiver.processPayment(merchant1, address(usdc), 1000e6, paymentId, DOMAIN_ETHEREUM);

        // Same paymentId, different merchant — still reverts
        vm.expectRevert(abi.encodeWithSelector(CCTPReceiver.CCTPReceiver__DuplicatePayment.selector, paymentId));
        receiver.processPayment(merchant2, address(usdc), 1000e6, paymentId, DOMAIN_ETHEREUM);
        vm.stopPrank();
    }

    /// @notice Multiple relayers can process payments
    function test_multipleRelayers() public {
        vm.prank(owner);
        receiver.setRelayer(relayer2, true);

        _simulateCCTPMint(address(usdc), 2000e6);

        vm.prank(relayer);
        receiver.processPayment(merchant1, address(usdc), 1000e6, keccak256("r1"), DOMAIN_ETHEREUM);

        vm.prank(relayer2);
        receiver.processPayment(merchant2, address(usdc), 1000e6, keccak256("r2"), DOMAIN_BASE);

        assertEq(pool.getMerchantBalance(merchant1, address(usdc)), 1000e6);
        assertEq(pool.getMerchantBalance(merchant2, address(usdc)), 1000e6);
    }
}
