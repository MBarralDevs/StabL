// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PaymentPool} from "../src/PaymentPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract VerifySettlement is Script {
    PaymentPool paymentPool = PaymentPool(0x5a100C9c5B7586cf014ACd65A7EEd592589bc3c4);
    IERC20 usdc = IERC20(0x4c20Ca8BF703fe85447954Af3EF0E3eCf16dEdb5);

    function run() external view {
        address merchant = vm.envAddress("DEPLOYER_PRIVATE_KEY") != address(0)
            ? vm.addr(vm.envUint("DEPLOYER_PRIVATE_KEY"))
            : address(0);

        console.log("=================================================");
        console.log("Settlement Verification");
        console.log("=================================================");
        console.log("");
        console.log("Merchant address:", merchant);
        console.log("");

        // Check PaymentPool balance (should be 0 after settlement)
        uint256 poolBalance = paymentPool.getMerchantBalance(merchant, address(usdc));
        console.log("PaymentPool balance:", poolBalance / 1e6, "USDC");

        if (poolBalance == 0) {
            console.log("Status: SETTLED (balance is 0)");
        } else {
            console.log("Status: PENDING (balance > 0)");
        }
        console.log("");

        // Check merchant's wallet balance
        uint256 walletBalance = usdc.balanceOf(merchant);
        console.log("Merchant wallet balance:", walletBalance / 1e6, "USDC");
        console.log("");

        console.log("=================================================");

        if (poolBalance == 0) {
            console.log("SUCCESS! Settlement completed.");
            console.log("Funds have been transferred to merchant wallet.");
        } else {
            console.log("Settlement not yet complete.");
            console.log("Check backend logs for processing status.");
        }
        console.log("=================================================");
    }
}
