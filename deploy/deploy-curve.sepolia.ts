import { deployContract, getWallet } from "./utils";

export default async function() {
  const wallet = getWallet();

  // Deploy Pool
  const poolImpl = await deployContract("CurveCryptoSwap2ETH", [
    "0x0000000000000000000000000000000000000000"
  ]);

  // Deploy Token
  const tokenImpl = await deployContract("CurveTokenV5");

  // Deploy ChildGuage
  const guageImpl = await deployContract("ChildGuage", [
    "0x0000000000000000000000000000000000000000",
    "0x0000000000000000000000000000000000000000"
  ]);

  // Deploy Factory
  const factory = await deployContract("Factory", [
    wallet.address,
    await poolImpl.getAddress(),
    await tokenImpl.getAddress(),
    await guageImpl.getAddress(),
    "0x0000000000000000000000000000000000000000"
  ]);

  // Deploy CurveMath
  const math = await deployContract("CurveMath");

  return { factory, poolImpl, tokenImpl, guageImpl, math };
}
