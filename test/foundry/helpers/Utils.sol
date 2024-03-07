// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.15;

// interfaces
import "../../../contracts/interfaces/IVault.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// utils
import {Test} from "forge-std/Test.sol";

abstract contract Utils is Test {
    function changeHoax(address user) public {
        deal(user, 1 << 128);
        changePrank(user);
    }

    function fundAndPrepareAccount(
        address user,
        uint256 amount,
        IVault vault,
        IERC20Metadata token
    ) public {
        deal(address(token), user, amount);
        changePrank(user);
        token.approve(address(vault), amount);
    }
}
