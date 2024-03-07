[![Formatting and Linting](https://github.com/Increment-Finance/increment-protocol/actions/workflows/lint.yml/badge.svg)](https://github.com/Increment-Finance/increment-protocol/actions/workflows/lint.yml)
[![Slither](https://github.com/Increment-Finance/increment-protocol/actions/workflows/slither.yml/badge.svg)](https://github.com/Increment-Finance/increment-protocol/actions/workflows/slither.yml)
[![Unit tests](https://github.com/Increment-Finance/increment-protocol/actions/workflows/tests.yml/badge.svg)](https://github.com/Increment-Finance/increment-protocol/actions/workflows/tests.yml)
[![codecov](https://codecov.io/gh/Increment-Finance/increment-protocol/branch/main/graph/badge.svg?token=VN8BL4MS3Y)](https://codecov.io/gh/Increment-Finance/increment-protocol)
[![Fuzzing](https://github.com/Increment-Finance/increment-protocol/actions/workflows/foundry.yml/badge.svg)](https://github.com/Increment-Finance/increment-protocol/actions/workflows/foundry.yml)

# Increment Protocol

This repository contains the smart contracts for Increment Protocol V1. The repository uses Hardhat as a development environment for compilation, testing and deployment tasks. Repo uses [template ethereum contracts](https://github.com/wighawag/template-ethereum-contracts) by
wighawag.

## What is Increment?

Increment utilizes pooled virtual assets and Curve V2’s AMM trading engine to enable on-chain perpetual swaps, allowing traders to long or short global exchange rates with leverage. As the "virtual" part implies, there are only virtual balances in the Curve V2 AMM. Liquidity providers deposit real funds and the system mints the corresponding amount of virtual assets in the AMM as liquidity trading. Liquidity providers receive trading fees in exchange for taking the opposite side of traders.

## Audit scope

### main/

- ClearingHouse
- Insurance
- Perpetual
- Vault
- CurveCryptoViewer
- ~~ClearingHouseViewer~~

### tokens/

- VBase
- VQuote
- UA

### lib/

- LibPerpetual
- LibReserve

## External dependencies

### contracts/curve

Includes the curve cryptoswap contracts and helpers

## Documentation

click [here](https://increment-team.gitbook.io/developer-docs/).

## Setup

Install node modules by running

`yarn install`

Prepare a .env file with the following variables

```
# mainnet rpc for mainnet forking
ETH_NODE_URI_MAINNET= "https://eth-mainnet.alchemyapi.io/YOUR_API_KEY"

# your mnemonic
MNEMONIC="test test test test test test test test test test test test"
```

We use alchemy to fork Ethereum Mainnet. You can get a free API key [here](https://www.alchemy.com/).

Install additional dependencies via

`yarn prepare`

## Compile objects

Compile artifacts:

`yarn hardhat compile`

Create typechain objects:

`yarn hardhat typechain`

Compile zk-artifacts:

`yarn hardhat compile --network zktestnet`

Compile all:

`yarn compile:all`

## Test

Run unit tests:

`yarn test:unit`

Run integration tests (require API key):

`yarn test:integration`

Run fuzz tests (require API key):

`yarn test:fuzzing`

Run slither (see slither.sh)

`yarn slither`

Run coverage

`yarn coverage`
