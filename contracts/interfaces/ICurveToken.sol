// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.15;

/// @dev Contract https://github.com/curvefi/curve-crypto-contract/blob/master/deployment-logs/2021-11-01.%20EURS%20on%20mainnet/CryptoSwap.vy
interface ICurveToken {
    function totalSupply() external view returns (uint256);

    function mint(address _to, uint256 _value) external returns (bool);

    function mint_relative(address _to, uint256 frac) external returns (uint256);

    function burnFrom(address _to, uint256 _value) external returns (bool);
}
