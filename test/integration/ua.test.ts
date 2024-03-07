import {expect} from 'chai';
import env, {ethers} from 'hardhat';
import {BigNumber} from 'ethers';

import {getReserveAddress} from '../../helpers/contracts-getters';
import {convertToCurrencyDecimals} from '../../helpers/contracts-helpers';
import {tokenToWad} from '../../helpers/contracts-helpers';
import {ZERO_ADDRESS} from '../../helpers/constants';

import {setup, User} from '../helpers/setup';
import {setUSDCBalance} from '../helpers/utils/manipulateStorage';

import {AccessControlErrors, UAErrors} from '../../helpers/errors';

const DAI_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const MAX_UINT_256 = ethers.constants.MaxUint256;

/*
 * UA is an integration test not for its interactions with the protocol,
 * but because we want to see the interaction with a working ERC20 token
 * acting as the `reserveToken` of UA, i.e. USDC.
 */
describe('UA', function () {
  let deployer: User, user: User;
  let usdcBalance: BigNumber;
  let uaBalance: BigNumber;

  beforeEach('Set up', async () => {
    ({deployer, user} = await setup());

    usdcBalance = await convertToCurrencyDecimals(deployer.usdc, '1000');
    uaBalance = await tokenToWad(await deployer.usdc.decimals(), usdcBalance);
    // create balance for deployer and trader
    await setUSDCBalance(env, deployer.usdc, deployer.address, usdcBalance);
  });

  it('Should be deployed with the correct ERC20 values', async () => {
    expect(await deployer.ua.name()).to.eq('Increment Unit of Account');
    expect(await deployer.ua.symbol()).to.eq('UA');

    const firstReserveToken = await deployer.ua.reserveTokens(0);
    expect(firstReserveToken.asset).to.eq(getReserveAddress('USDC', env));
    expect(firstReserveToken.currentReserves).to.eq(0);
    expect(firstReserveToken.mintCap).to.eq(MAX_UINT_256);
  });

  it('Should fail if non-governance address tries to add a reserve token', async () => {
    await expect(user.ua.addReserveToken(DAI_ADDRESS, 0)).to.be.revertedWith(
      AccessControlErrors.revertGovernance(user.address)
    );
  });

  it('Should fail if governance address tries to add the same reserve token more than once', async function () {
    const numReserveTokens = await deployer.ua.getNumReserveTokens();
    expect(numReserveTokens).to.eq(1);

    const usdcAddress = (await user.ua.reserveTokens(0)).asset;

    await expect(deployer.ua.addReserveToken(usdcAddress, 0)).to.revertedWith(
      UAErrors.ReserveTokenAlreadyAssigned
    );

    expect(await deployer.ua.getNumReserveTokens()).to.eq(numReserveTokens);
  });

  it('Should fail if deployer tries to add a reserve token at address(0)', async function () {
    await expect(deployer.ua.addReserveToken(ZERO_ADDRESS, 0)).to.revertedWith(
      UAErrors.ReserveTokenZeroAddress
    );
  });

  it('Should work to add a new reserve', async () => {
    const numReserveTokens = await deployer.ua.getNumReserveTokens();

    await expect(deployer.ua.addReserveToken(DAI_ADDRESS, MAX_UINT_256.div(2)))
      .to.emit(deployer.ua, 'ReserveTokenAdded')
      .withArgs(DAI_ADDRESS, numReserveTokens.add(1));

    expect(await deployer.ua.getNumReserveTokens()).to.eq(
      numReserveTokens.add(1)
    );

    const newReserveToken = await deployer.ua.reserveTokens(1);
    expect(newReserveToken.asset).to.eq(DAI_ADDRESS);
    expect(newReserveToken.currentReserves).to.eq(0);
    expect(newReserveToken.mintCap).to.eq(MAX_UINT_256.div(2));
  });

  it('Should fail to update the max mint cap of a reserve token if user isnt governance address', async () => {
    await expect(
      user.ua.changeReserveTokenMaxMintCap(0, MAX_UINT_256.div(10))
    ).to.revertedWith(AccessControlErrors.revertGovernance(user.address));
  });

  it('Should fail to update the max mint cap of a reserve token if token isnt whitelisted', async () => {
    const reserveTokenLength = await user.ua.getNumReserveTokens();

    await expect(
      deployer.ua.changeReserveTokenMaxMintCap(
        reserveTokenLength,
        MAX_UINT_256.div(10)
      )
    ).to.revertedWith(UAErrors.InvalidReserveTokenIndex);
  });

  it('Should work to update the max mint cap of a reserve token', async () => {
    const newMaxMintCap = MAX_UINT_256.div(10);

    await expect(deployer.ua.changeReserveTokenMaxMintCap(0, newMaxMintCap))
      .to.emit(deployer.ua, 'ReserveTokenMaxMintCapUpdated')
      .withArgs(deployer.usdc.address, newMaxMintCap);

    const usdcReserveToken = await deployer.ua.reserveTokens(0);
    expect(usdcReserveToken.mintCap).to.eq(newMaxMintCap);
  });

  it('Should fail if user tries to mint UA with unsupported token', async () => {
    const reserveTokenLength = await user.ua.getNumReserveTokens();

    await expect(
      deployer.ua.mintWithReserve(reserveTokenLength, usdcBalance)
    ).to.be.revertedWith(UAErrors.InvalidReserveTokenIndex);
  });

  it('Should fail if user tries to mint UA without amount allowance', async () => {
    await expect(
      deployer.ua.mintWithReserve(0, usdcBalance)
    ).to.be.revertedWith('ERC20: transfer amount exceeds allowance');
  });

  it('Should fail if user tries to mint UA without right amount of reserve token', async () => {
    const amountGreatThanUserBalance = usdcBalance.mul(2);
    await deployer.usdc.approve(
      deployer.ua.address,
      amountGreatThanUserBalance
    );

    await expect(
      deployer.ua.mintWithReserve(0, amountGreatThanUserBalance)
    ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
  });

  it('Should fail if user tries to mint more UA than what the reserve token cap allows', async () => {
    await deployer.ua.addReserveToken(DAI_ADDRESS, MAX_UINT_256.div(10));

    await expect(
      deployer.ua.mintWithReserve(1, MAX_UINT_256.div(5))
    ).to.revertedWith(UAErrors.ExcessiveTokenMintCapReached);
  });

  it('Should mint UA if user provides appropriate amount of a white listed reserve token', async () => {
    const initialUSDCcurrentReserves = (await deployer.ua.reserveTokens(0))
      .currentReserves;
    expect(initialUSDCcurrentReserves).to.eq(0);

    await deployer.usdc.approve(deployer.ua.address, usdcBalance);
    await deployer.ua.mintWithReserve(0, usdcBalance);

    // check balances updated (USDC and UA), both for user and UA contract
    expect(await deployer.usdc.balanceOf(deployer.address)).to.eq(0);
    expect(await deployer.usdc.balanceOf(deployer.ua.address)).to.eq(
      usdcBalance
    );
    expect(await deployer.ua.balanceOf(deployer.address)).to.eq(uaBalance);
    // note: unless someone transfers UA to the UA contract, UA never accrues a UA balance
    expect(await deployer.ua.balanceOf(deployer.ua.address)).to.eq(0);

    expect(await deployer.ua.totalSupply()).to.eq(uaBalance);

    const newUSDCcurrentReserves = (await deployer.ua.reserveTokens(0))
      .currentReserves;
    expect(newUSDCcurrentReserves).to.eq(
      await tokenToWad(await deployer.usdc.decimals(), usdcBalance)
    );
  });

  it('Should fail if user tries to mint UA with unsupported token', async () => {
    const reserveTokenLength = await user.ua.getNumReserveTokens();

    await expect(
      deployer.ua.withdraw(reserveTokenLength, 0)
    ).to.be.revertedWith(UAErrors.InvalidReserveTokenIndex);
  });

  it('Should fail if user tries to withdraw an amount larger than what he owns', async () => {
    // set-up: create a UA balance
    await deployer.usdc.approve(deployer.ua.address, usdcBalance);
    await deployer.ua.mintWithReserve(0, usdcBalance);

    await expect(deployer.ua.withdraw(0, uaBalance.mul(2))).to.be.reverted;
  });

  it('Should withdraw amount that user owns', async () => {
    // set-up: create a UA balance
    await deployer.usdc.approve(deployer.ua.address, usdcBalance);
    await deployer.ua.mintWithReserve(0, usdcBalance);

    await deployer.ua.withdraw(0, uaBalance);

    // check balances updated (USDC and UA), both for user and UA contract
    expect(await deployer.usdc.balanceOf(deployer.address)).to.eq(usdcBalance);
    expect(await deployer.usdc.balanceOf(deployer.ua.address)).to.eq(0);
    expect(await deployer.ua.balanceOf(deployer.address)).to.eq(0);
    // note: unless someone transfers UA to the UA contract, UA never accrues a UA balance
    expect(await deployer.ua.balanceOf(deployer.ua.address)).to.eq(0);

    expect(await deployer.ua.totalSupply()).to.eq(0);

    const USDCcurrentReservesAfterWithdraw = (
      await deployer.ua.reserveTokens(0)
    ).currentReserves;
    expect(USDCcurrentReservesAfterWithdraw).to.eq(0);
  });
});
