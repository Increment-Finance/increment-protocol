// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.16;

// libraries
import {PRBMathUD60x18} from "../../lib/prb-math/contracts/PRBMathUD60x18.sol";
import {PRBMathSD59x18} from "../../lib/prb-math/contracts/PRBMathSD59x18.sol";
import {SafeCast} from "../../lib/openzeppelin-contracts/contracts/utils/math/SafeCast.sol";
import {Math} from "../../lib/openzeppelin-contracts/contracts/utils/math/Math.sol";
import {SignedMath} from "../../lib/openzeppelin-contracts/contracts/utils/math/SignedMath.sol";

/*
 * To be used if `b` decimals make `b` larger than what it would be otherwise.
 * Especially useful for fixed point numbers, i.e. a way to represent decimal
 * values without using decimals. E.g. 25e2 with 3 decimals represents 2.5%
 *
 * In our case, we get exchange rates with a 18 decimal precision
 * (Solidity doesn't support decimal values natively).
 * So if we have a BASE positions and want to get the equivalent USD amount
 * we have to do: BASE_position * BASE_USD / 1e18 else the value would be way too high.
 * To move from USD to BASE: (USD_position * 1e18) / BASE_USD else the value would
 * be way too low.
 *
 * In essence,
 * wadMul: a.mul(b).div(WAY)
 * wadDiv: a.mul(WAY).div(b)
 * where `WAY` represents the number of decimals
 */
library LibMath {
    /* ****************** */
    /*   Safe casting     */
    /* ****************** */

    // int256 -> uint256
    function toUint256(int256 x) internal pure returns (uint256) {
        return SafeCast.toUint256(x);
    }

    // uint256 -> int256
    function toInt256(uint256 x) internal pure returns (int256) {
        return SafeCast.toInt256(x);
    }

    // uint256 -> uint128
    function toUint128(uint256 x) internal pure returns (uint128) {
        return SafeCast.toUint128(x);
    }

    // int256 -> int128
    function toInt128(int256 x) internal pure returns (int128) {
        return SafeCast.toInt128(x);
    }

    // uint256 -> uint64
    function toUint64(uint256 x) internal pure returns (uint64) {
        return SafeCast.toUint64(x);
    }

    /* ********************* */
    /*   Other operations    */
    /* ********************* */

    // absolute value
    function abs(int256 x) internal pure returns (int256) {
        return PRBMathSD59x18.abs(x);
    }

    // min value
    function min(int256 x, int256 y) internal pure returns (int256) {
        return SignedMath.min(x, y);
    }

    function min(uint256 x, uint256 y) internal pure returns (uint256) {
        return Math.min(x, y);
    }

    // int256: wad division / multiplication
    function wadDiv(int256 x, int256 y) internal pure returns (int256) {
        return PRBMathSD59x18.div(x, y);
    }

    function wadMul(int256 x, int256 y) internal pure returns (int256) {
        return PRBMathSD59x18.mul(x, y);
    }

    // uint256: wad division / multiplication
    function wadMul(uint256 x, uint256 y) internal pure returns (uint256) {
        return PRBMathUD60x18.mul(x, y);
    }

    function wadDiv(uint256 x, uint256 y) internal pure returns (uint256) {
        return PRBMathUD60x18.div(x, y);
    }
}
