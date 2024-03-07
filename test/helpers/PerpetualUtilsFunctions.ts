import {BigNumber, BigNumberish, Contract, constants, utils} from 'ethers';
import {ethers} from 'hardhat';
import {HardhatRuntimeEnvironment} from 'hardhat/types';

import {User} from './setup';
import {Side} from './utils/types';
import {
  IERC20Metadata,
  MintableERC20,
  MintableERC20__factory,
} from '../../typechain';

import {wadToToken} from '../../helpers/contracts-helpers';
import {getChainlinkOracle} from '../../helpers/contracts-getters';
import {setUSDCBalance} from '../helpers/utils/manipulateStorage';
import {hours} from '../../helpers/time';

import {getMarket, getPerpetual} from './PerpetualGetters';
import {getLiquidityProviderProposedAmount} from './LiquidityGetters';
import {getCloseProposedAmount, getCloseTradeDirection} from './TradingGetters';
import {expect} from 'chai';
import {rDiv} from './utils/calculations';
import {MAX_UINT_AMOUNT} from '../../helpers/constants';

/* ******************** */
/* Insurance operations */
/* ******************** */

export async function sendUAToInsurance(
  user: User,
  amount: BigNumber
): Promise<void> {
  await _checkTokenBalance(user, user.ua, amount);
  await user.ua.transfer(user.insurance.address, amount);
}

/* ******************** */
/*   UA operations   */
/* ******************** */

export async function mintUA(user: User, amount: BigNumber): Promise<void> {
  // get liquidity amount in USD
  const tokenAmount = await wadToToken(await user.usdc.decimals(), amount);
  await _checkTokenBalance(user, user.usdc, tokenAmount);

  // mint ua tokens
  await (await user.usdc.approve(user.ua.address, tokenAmount)).wait();
  await (await user.ua.mintWithReserve(0, tokenAmount)).wait();
  expect(await user.ua.balanceOf(user.address)).to.be.equal(amount);
}

export async function burnUA(user: User, amount: BigNumber): Promise<void> {
  // burn ua tokens
  await _checkTokenBalance(user, user.ua, amount);
  await user.ua.withdraw(0, amount);

  // get liquidity amount in USD
  const tokenAmount = await wadToToken(await user.usdc.decimals(), amount);
  expect(await user.usdc.balanceOf(user.address)).to.be.equal(tokenAmount);
}
/* ******************** */
/*   Vault operations   */
/* ******************** */

// Important `token` must the token of the user
export async function depositIntoVault(
  user: User,
  token: IERC20Metadata,
  amount: BigNumber
): Promise<void> {
  // get liquidity amount in USD
  const tokenAmount = await wadToToken(await token.decimals(), amount);
  await _checkTokenBalance(user, token, tokenAmount);

  await (await token.approve(user.vault.address, tokenAmount)).wait();
  await (await user.clearingHouse.deposit(tokenAmount, token.address)).wait();
}

// Important `token` must the token of the user
export async function withdrawFromVault(
  user: User,
  token: IERC20Metadata,
  amount: BigNumber
): Promise<void> {
  // get liquidity amount in USD
  const tokenAmount = await wadToToken(await token.decimals(), amount);
  await _checkTokenBalance(user, token, tokenAmount);

  await user.clearingHouse.withdraw(tokenAmount, token.address);
}

/* ********************************* */
/*   liquidity provider operations   */
/* ********************************* */

// Important `token` must the token of the user
// Increase sequentCallNb by 1 for every call to the function before any trading operation
export async function depositCollateralAndProvideLiquidity(
  user: User,
  token: IERC20Metadata,
  quoteAmount: BigNumber,
  marketIdx: BigNumberish = 0,
  sequentCallNb = 0,
  baseAmount: BigNumber = MAX_UINT_AMOUNT
): Promise<void> {
  // get liquidity amount in USD
  const tokenAmount = await wadToToken(await token.decimals(), quoteAmount);
  await _checkTokenBalance(user, token, tokenAmount);

  await (await token.approve(user.vault.address, tokenAmount)).wait();
  await (await user.clearingHouse.deposit(tokenAmount, token.address)).wait();

  // default is to mint with market prices
  if (MAX_UINT_AMOUNT) {
    const perpetual = await getPerpetual(user, marketIdx);
    baseAmount = rDiv(quoteAmount, await perpetual.indexPrice());
  }
  quoteAmount = quoteAmount.sub(2 * sequentCallNb);

  await (
    await user.clearingHouse.provideLiquidity(
      marketIdx,
      [quoteAmount, baseAmount],
      0
    )
  ).wait();
}

// withdraw liquidity
export async function removeLiquidity(
  user: User,
  marketIdx: BigNumberish = 0
): Promise<void> {
  const userLpPositionBefore = await user.clearingHouseViewer.getLpPosition(
    marketIdx,
    user.address
  );

  if (userLpPositionBefore.liquidityBalance.isZero()) {
    throw new Error('Provided liquidity is zero');
  }

  const proposedAmount = await getLiquidityProviderProposedAmount(
    user,
    userLpPositionBefore,
    userLpPositionBefore.liquidityBalance,
    marketIdx
  );

  await (
    await user.clearingHouse.removeLiquidity(
      marketIdx,
      userLpPositionBefore.liquidityBalance,
      [0, 0],
      proposedAmount,
      0
    )
  ).wait();
}

/* ********************************* */
/*          Trader operations        */
/* ********************************* */

// Important `token` must the token of the user
export async function extendPositionWithCollateral(
  user: User,
  token: IERC20Metadata,
  depositAmount: BigNumber,
  positionAmount: BigNumber,
  direction: Side,
  marketIdx: BigNumberish = 0
): Promise<void> {
  // get liquidity amount in USD
  const tokenAmount = await wadToToken(await token.decimals(), depositAmount);
  await _checkTokenBalance(user, token, tokenAmount);

  await (await token.approve(user.vault.address, tokenAmount)).wait();

  await (
    await user.clearingHouse.extendPositionWithCollateral(
      marketIdx,
      tokenAmount,
      token.address,
      positionAmount,
      direction,
      0
    )
  ).wait();
}

// close a position
export async function closePosition(
  user: User,
  token: IERC20Metadata,
  marketIdx: BigNumberish = 0
): Promise<void> {
  const traderPosition = await user.clearingHouseViewer.getTraderPosition(
    marketIdx,
    user.address
  );

  const market = await getMarket(user, marketIdx);

  const proposedAmount = await getCloseProposedAmount(
    traderPosition,
    market,
    user.curveViews
  );

  await (
    await user.clearingHouse.changePosition(
      marketIdx,
      proposedAmount,
      0,
      getCloseTradeDirection(traderPosition)
    )
  ).wait();

  await withdrawCollateral(user, token);
}

export async function withdrawCollateral(
  user: User,
  token: IERC20Metadata
): Promise<void> {
  const userDeposits = await user.vault.getReserveValue(user.address, false);
  await (await user.clearingHouse.withdraw(userDeposits, token.address)).wait();
}

/* ******************************** */
/*          Vault operations        */
/* ******************************** */

// Can create and whitelist as many collateral as needed
export async function whiteListAsset(
  deployer: User,
  env: HardhatRuntimeEnvironment,
  weight: BigNumber = constants.WeiPerEther,
  fixedPrice: BigNumber = constants.WeiPerEther
): Promise<MintableERC20> {
  const [DEPLOYER] = await ethers.getSigners();

  // deploy erc20
  const erc20Factory = new MintableERC20__factory(DEPLOYER);

  // multiple collaterals/ERC20s can be deployed w/ the exact same name and symbol,
  // not an issue in our tests as long as we don't check `name` and `symbol`
  const token = await erc20Factory.deploy('CollateralToken', 'ColTok');

  // add in vault
  await (
    await deployer.vault.addWhiteListedCollateral(
      token.address,
      weight,
      constants.MaxUint256
    )
  ).wait();

  // add oracle || just use usdc oracle
  const usdcChainlinkOracle = getChainlinkOracle(env, 'USDC');
  const forexHeartBeat = hours(25);
  await (
    await deployer.oracle.setOracle(
      token.address,
      usdcChainlinkOracle,
      forexHeartBeat,
      false
    )
  ).wait();

  await (await deployer.oracle.setFixedPrice(token.address, fixedPrice)).wait();

  return token;
}

export async function addTokenToUser(
  user: User,
  tokenContract: Contract,
  tokenName: string
): Promise<User & {[tokenName: string]: typeof tokenContract}> {
  return Object.assign(user, {
    [tokenName]: tokenContract.connect(await ethers.getSigner(user.address)),
  });
}

export async function addUSDCCollateralAndUSDCBalanceToUsers(
  deployer: User,
  env: HardhatRuntimeEnvironment,
  amount: BigNumber,
  usersToGiveUSDCBalanceAndAllowanceForVault: User[]
): Promise<BigNumber> {
  await whiteListUSDCAsCollateral(deployer, env);

  const usdcBalance = await wadToToken(await deployer.usdc.decimals(), amount);

  for (const user of usersToGiveUSDCBalanceAndAllowanceForVault) {
    await setUSDCBalance(env, user.usdc, user.address, usdcBalance);
    await (await user.usdc.approve(user.vault.address, usdcBalance)).wait();
  }

  return usdcBalance;
}

// Important `deployer` must be the owner of the Vault contract
export async function whiteListUSDCAsCollateral(
  deployer: User,
  env: HardhatRuntimeEnvironment
): Promise<void> {
  if (
    (await deployer.vault.tokenToCollateralIdx(deployer.usdc.address)) !==
    BigNumber.from(0)
  ) {
    /// @dev: Use the parameters for market for regular deployments
    // add in vault
    await (
      await deployer.vault.addWhiteListedCollateral(
        deployer.usdc.address,

        utils.parseEther('1'),
        constants.MaxUint256
      )
    ).wait();
  }
  // add oracle
  const usdcChainlinkOracle = getChainlinkOracle(env, 'USDC');
  const forexHeartBeat = hours(25);
  await (
    await deployer.oracle.setOracle(
      deployer.usdc.address,
      usdcChainlinkOracle,
      forexHeartBeat,
      false
    )
  ).wait();
  await (
    await deployer.oracle.setFixedPrice(
      deployer.ua.address,
      utils.parseEther('1')
    )
  ).wait();
}

/* ********************************* */
/*          Utils                    */
/* ********************************* */

async function _checkTokenBalance(
  user: User,
  token: IERC20Metadata,
  amountToCheck: BigNumber
): Promise<void> {
  const tokenBalance = await token.balanceOf(user.address);
  if (amountToCheck.gt(tokenBalance)) {
    throw `${user.address} balance of ${tokenBalance} not enough to deposit ${amountToCheck}`;
  }
}
