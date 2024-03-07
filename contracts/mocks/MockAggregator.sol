// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

/// @dev Dummy implementation of the interface. Contract meant to be mocked
contract MockAggregator is AggregatorV3Interface {
    uint8 public override decimals;
    string public override description = "MockAggregator";
    uint256 public override version = 3;

    constructor(uint8 _decimals) {
        // 8 for all forex pairs: https://docs.chain.link/docs/ethereum-addresses/
        decimals = _decimals;
    }

    function getRoundData(uint80 _roundId)
        external
        pure
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_roundId, 0, 0, 0, 0);
    }

    function latestRoundData()
        external
        pure
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (0, 0, 0, 0, 0);
    }
}
