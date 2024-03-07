import {findPriceSlot} from './bruteForce';
import env = require('hardhat');

const EUR_USD_PRICEFEED_ADDRESS = '0xb49f677943BC038e9857d61E7d053CaA2C1734C1';

async function main() {
  console.log(
    'Searching for storage slot of price feed EUR_USD on network',
    env.network.name
  );

  const priceStorageSlot = await findPriceSlot(EUR_USD_PRICEFEED_ADDRESS);
  console.log('Price has storage slot:', priceStorageSlot);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
