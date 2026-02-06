// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TestUSDCTransfer is Script {
    IERC20 usdc = IERC20(0x3600000000000000000000000000000000000000);

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        console.log("Testing USDC transfer...");
        console.log("From:", deployer);
        console.log("Balance:", usdc.balanceOf(deployer) / 1e6, "USDC");

        // Try transferring to yourself (should work if not blocklisted)
        usdc.transfer(deployer, 1e6); // Transfer 1 USDC to yourself

        console.log("Transfer successful!");

        vm.stopBroadcast();
    }
}
