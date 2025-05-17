const fs = require('fs');
const path = require('path');
const { utils: { generateKeyPair } } = require('ssh2');

// Create keys directory if it doesn't exist
const keysDir = path.join(__dirname, 'keys');
if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir);
}

// Generate host key
console.log('Generating host key...');
generateKeyPair('rsa', { bits: 2048 }, (err, keys) => {
  if (err) throw err;
  
  // Save private key
  fs.writeFileSync(path.join(keysDir, 'host.key'), keys.private);
  console.log('Host private key saved to keys/host.key');
  
  // Save public key
  fs.writeFileSync(path.join(keysDir, 'host.key.pub'), keys.public);
  console.log('Host public key saved to keys/host.key.pub');
});
