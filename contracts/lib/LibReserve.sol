// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.16;

// libraries
import {LibMath} from "./LibMath.sol";

library LibReserve {
    using LibMath for uint256;

    uint8 internal constant PROTOCOL_DECIMALS = 18;

    /// @notice Convert amount from 'tokenDecimals' to 18 decimals precision
    /// @param tokenDecimals Decimals of the token. 8 decimals uint like in the ERC20 standard
    /// @param tokenAmount Amount with tokenDecimals precision
    /// @return wadAmount Scaled amount to the proper number of decimals
    function tokenToWad(uint8 tokenDecimals, uint256 tokenAmount) internal pure returns (uint256) {
        if (tokenDecimals == PROTOCOL_DECIMALS) {
            return tokenAmount;
        } else if (tokenDecimals < PROTOCOL_DECIMALS) {
            return tokenAmount * (10 ** (PROTOCOL_DECIMALS - tokenDecimals));
        }

        return tokenAmount / (10 ** (tokenDecimals - PROTOCOL_DECIMALS));
    }

    /// @notice Convert amount from 'tokenDecimals' decimals to 18 decimals precision
    /// @param tokenDecimals Decimals of the token. 8 decimals uint like in the ERC20 standard
    /// @param wadAmount Amount with 18 decimals precision
    /// @return amount Amount scaled back to the initial amount of decimals
    function wadToToken(uint8 tokenDecimals, uint256 wadAmount) internal pure returns (uint256) {
        if (tokenDecimals == PROTOCOL_DECIMALS) {
            return wadAmount;
        } else if (tokenDecimals < PROTOCOL_DECIMALS) {
            return wadAmount / (10 ** (PROTOCOL_DECIMALS - tokenDecimals));
        }

        return wadAmount * 10 ** (tokenDecimals - PROTOCOL_DECIMALS);
    }
}
