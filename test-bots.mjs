import https from 'https';

const tokens = [
  '8674460757:AAFm7WVkDx4ISkx22toTQyrQUeGQfLdF8QM',
  '8733182475:AAFBitv4g4LVRuvGnssyqHQpttBydeAda9Y',
  '8774720953:AAGvExABKj4Z-DYfKdqF-OMEdoeySeOeOoY',
];

function getMe(token) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${token}/getMe`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } 
        catch { reject(data); }
      });
    }).on('error', reject);
  });
}

async function test() {
  for (const token of tokens) {
    try {
      const data = await getMe(token);
      console.log(`Bot ${token.split(':')[0]}: ${data.ok ? `✅ @${data.result.username}` : `❌ ${data.description}`}`);
    } catch (e) {
      console.log(`Bot ${token.split(':')[0]}: ❌ ${e.message || e}`);
    }
  }
}

test();
