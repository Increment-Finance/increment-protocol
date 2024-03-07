// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

// contracts
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Mock StableSwap market to test buying/selling of derivative toknens
/// @dev Uses the well-known x * y = k formula

contract MockStableSwap is Ownable {
    struct Pool {
        uint256 vQuote;
        uint256 vBase;
        uint256 totalAssetReserve;
        uint256 price; // 10 ** 18
    }

    uint256 constant DECIMALS = 10**18;
    Pool public pool;

    constructor(uint256 _vQuote, uint256 _vBase) Ownable() {
        pool.vQuote = _vQuote;
        pool.vBase = _vBase;
        pool.totalAssetReserve = _vQuote * _vBase;
        pool.price = (_vBase * DECIMALS) / _vQuote;
    }

    /************************* events *************************/
    event NewReserves(uint256 vBase, uint256 vQuote, uint256 newPrice, uint256 blockNumber);

    /************************* functions *************************/

    /* mint vBase to go long euro */
    function mintVBase(uint256 amount) external onlyOwner returns (uint256) {
        uint256 vBasenew = pool.vBase + amount;
        uint256 vQuoteNew = pool.totalAssetReserve / vBasenew; // x = k / y
        uint256 buy = pool.vQuote - vQuoteNew;

        _updateBalances(vBasenew, vQuoteNew);

        return buy;
    }

    /* burn vBase to go short euro */
    function burnVBase(uint256 amount) external onlyOwner returns (uint256) {
        uint256 vBasenew = pool.vBase - amount;
        uint256 vQuoteNew = pool.totalAssetReserve / vBasenew; // x = k / y
        uint256 buy = vQuoteNew - pool.vQuote;
        _updateBalances(vBasenew, vQuoteNew);

        return buy;
    }

    /* mint vQuote to close long euro */
    function mintVQuote(uint256 amount) external onlyOwner returns (uint256) {
        uint256 vQuoteNew = pool.vQuote + amount;
        uint256 vBasenew = pool.totalAssetReserve / vQuoteNew; // x = k / y
        uint256 sell = pool.vBase - vBasenew;

        _updateBalances(vBasenew, vQuoteNew);

        return sell;
    }

    /* burn vQuote to close short euro */
    function burnVQuote(uint256 amount) external onlyOwner returns (uint256) {
        uint256 vQuoteNew = pool.vBase - amount;
        uint256 vBasenew = pool.totalAssetReserve / vQuoteNew; // x = k / y
        uint256 sell = vBasenew - pool.vBase;

        _updateBalances(vBasenew, vQuoteNew);

        return sell;
    }

    /* update reserve balances after buying/selling */
    function _updateBalances(uint256 vBaseNew, uint256 vQuoteNew) internal {
        uint256 newPrice = (vBaseNew * DECIMALS) / vQuoteNew;

        pool.price = newPrice;
        pool.vBase = vBaseNew;
        pool.vQuote = vQuoteNew;

        emit NewReserves(vBaseNew, vQuoteNew, newPrice, block.number);
    }
}
