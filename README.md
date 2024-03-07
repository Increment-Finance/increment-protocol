[![Formatting and Linting](https://github.com/Increment-Finance/increment-protocol/actions/workflows/lint.yml/badge.svg)](https://github.com/Increment-Finance/increment-protocol/actions/workflows/lint.yml) [![Slither](https://github.com/Increment-Finance/increment-protocol/actions/workflows/slither.yml/badge.svg)](https://github.com/Increment-Finance/increment-protocol/actions/workflows/slither.yml) [![Fuzzing](https://github.com/Increment-Finance/increment-protocol/actions/workflows/test.yml/badge.svg)](https://github.com/Increment-Finance/increment-protocol/actions/workflows/test.yml) [![Line Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/increment-bot/bc4d7f80aa422d6d020a11baf639db03/raw/increment-protocol-line-coverage__heads_main.json)](https://github.com/Increment-Finance/increment-protocol/actions/workflows/coverage.yml) [![Statement Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/increment-bot/bc4d7f80aa422d6d020a11baf639db03/raw/increment-protocol-statement-coverage__heads_main.json)](https://github.com/Increment-Finance/increment-protocol/actions/workflows/coverage.yml) [![Branch Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/increment-bot/bc4d7f80aa422d6d020a11baf639db03/raw/increment-protocol-branch-coverage__heads_main.json)](https://github.com/Increment-Finance/increment-protocol/actions/workflows/coverage.yml) [![Function Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/increment-bot/bc4d7f80aa422d6d020a11baf639db03/raw/increment-protocol-function-coverage__heads_main.json)](https://github.com/Increment-Finance/increment-protocol/actions/workflows/coverage.yml)

# Increment Protocol

This repository contains the smart contracts for Increment Protocol V1\. The repository uses Foundry as a development environment for compilation, testing and deployment tasks.

## What is Increment?

Increment utilizes pooled virtual assets and Curve V2's AMM trading engine to enable on-chain perpetual swaps, allowing traders to long or short global exchange rates with leverage. As the "virtual" part implies, there are only virtual balances in the Curve V2 AMM. Liquidity providers deposit real funds and the system mints the corresponding amount of virtual assets in the AMM as liquidity trading. Liquidity providers receive trading fees in exchange for taking the opposite side of traders.

## Audit scope

### main/

- ClearingHouse
- Insurance
- Perpetual
- Vault
- CurveCryptoViewer (only `get_dy_ex_fees`)
- ~~ClearingHouseViewer~~

### tokens/

- VBase
- VQuote
- UA

### lib/

- LibPerpetual
- LibReserve

### utils /

- IncreAccessControl

- PerpOwnable

## External dependencies

### contracts/curve

Includes the curve cryptoswap contracts and helpers

## Documentation

click [here](https://increment-team.gitbook.io/developer-docs/).

## Setup

Install foundry

```sh
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Prepare a .env file with the following variables

```
# mainnet rpc for mainnet forking
ETH_NODE_URI_MAINNET= "https://eth-mainnet.alchemyapi.io/YOUR_API_KEY"

# your mnemonic
MNEMONIC="test test test test test test test test test test test test"
```

We use alchemy to fork Ethereum Mainnet. You can get a free API key [here](https://www.alchemy.com/).

## Compile objects

```sh
forge build
```

## Test

Run unit tests:

```sh
forge test --fork-url $ETH_NODE_URI_MAINNET -vvv
```

Run slither

```sh
pip install -r requirements.txt
forge build
chmod +x ./slither.sh
./slither.sh
```

Run coverage

`forge coverage`
