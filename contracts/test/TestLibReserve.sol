// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// libraries
import "../lib/LibReserve.sol";

contract TestLibReserve {
    function tokenToWad(uint8 tokenDecimals, uint256 amount) external pure returns (uint256) {
        return LibReserve.tokenToWad(tokenDecimals, amount);
    }

    function wadToToken(uint8 tokenDecimals, uint256 wadAmount) external pure returns (uint256) {
        return LibReserve.wadToToken(tokenDecimals, wadAmount);
    }
}
