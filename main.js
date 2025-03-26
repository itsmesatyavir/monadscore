const fs = require('fs');
const ethers = require('ethers');
const axios = require('axios');
const blessed = require('blessed');
const { HttpProxyAgent } = require('http-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

const screen = blessed.screen({
    smartCSR: true,
    title: 'Auto Bot Monad Score'
});

const banner = blessed.box({
    parent: screen,
    top: 0,
    left: 'center',
    width: '100%',
    height: 3,
    content: '{center}{bold}MONADSCORE Refer Bot - Forest Army {/bold}{/center}',
    tags: true,
    style: { fg: 'cyan' },
    border: { type: 'line', fg: 'white' }
});

const logs = blessed.log({
    parent: screen,
    top: 3,
    left: 0,
    width: '70%', 
    height: '96%', 
    label: ' Logs ',
    tags: true,
    border: { type: 'line', fg: 'white' },
    scrollable: true,
    scrollbar: { bg: 'blue' }
});

const stats = blessed.box({
    parent: screen,
    top: 3,
    right: 0,
    width: '30%',
    height: '30%',
    label: ' Stats ',
    tags: true,
    border: { type: 'line', fg: 'white' }
});

const walletsBox = blessed.box({
    parent: screen,
    top: '33%',
    right: 0,
    width: '30%',
    height: '67%',
    label: ' Wallets ',
    tags: true,
    border: { type: 'line', fg: 'white' },
    scrollable: true,
    scrollbar: { bg: 'blue' }
});

const prompt = blessed.prompt({
    parent: screen,
    top: 'center',
    left: 'center',
    height: 5,
    width: 25,
    border: 'line',
    hidden: true
});

const BASE_URL = 'https://mscore.onrender.com';
const MAX_RETRIES = 3;

// Read referral code from code.txt
let REFERRAL_CODE = '';
try {
    if (fs.existsSync('code.txt')) {
        REFERRAL_CODE = fs.readFileSync('code.txt', 'utf-8').trim();
        if (!REFERRAL_CODE) {
            logs.log('{yellow-fg}Warning: code.txt is empty{/yellow-fg}');
        }
    } else {
        logs.log('{red-fg}Error: code.txt not found{/red-fg}');
    }
} catch (error) {
    logs.log(`{red-fg}Error reading code.txt: ${error.message}{/red-fg}`);
}

const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'origin': 'https://monadscore.xyz',
    'referer': 'https://monadscore.xyz/'
};

function cleanHeaders(headers) {
    const cleanedHeaders = {};
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string') {
            cleanedHeaders[key] = value.replace(/[^\x20-\x7E]/g, '');
        } else {
            cleanedHeaders[key] = value;
        }
    }
    return cleanedHeaders;
}

function parseProxy(proxy) {
    try {
        const proxyRegex = /^(http|socks4|socks5):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/;
        const match = proxy.match(proxyRegex);
        if (!match) {
            throw new Error('Invalid proxy format');
        }

        const [, type, username, password, host, port] = match;
        const encodedUsername = encodeURIComponent(username || '');
        const encodedPassword = encodeURIComponent(password || '');
        const cleanProxy = `${type}://${encodedUsername}:${encodedPassword}@${host}:${port}`;

        return { type, url: cleanProxy, originalUrl: proxy };
    } catch (e) {
        logs.log(`{red-fg}Proxy parse error: ${proxy} - ${e.message}{/red-fg}`);
        return null;
    }
}

let proxies = [];
if (fs.existsSync('proxies.txt')) {
    const proxyLines = fs.readFileSync('proxies.txt', 'utf-8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    proxies = proxyLines
        .map(proxy => parseProxy(proxy))
        .filter(proxy => proxy !== null)
        .map(proxy => proxy.url);
}

function getRandomProxy(usedProxies = new Set()) {
    if (proxies.length === 0) return null;
    let availableProxies = proxies.filter(proxy => !usedProxies.has(proxy));
    if (availableProxies.length === 0) return null;

    const proxy = availableProxies[Math.floor(Math.random() * availableProxies.length)];
    usedProxies.add(proxy);

    try {
        if (proxy.startsWith('http')) {
            return { type: 'http', agent: new HttpProxyAgent(proxy), url: proxy };
        } else if (proxy.startsWith('socks4') || proxy.startsWith('socks5')) {
            return { type: 'socks', agent: new SocksProxyAgent(proxy), url: proxy };
        }
        return null;
    } catch (e) {
        logs.log(`{red-fg}Proxy parse error: ${proxy} - ${e.message}{/red-fg}`);
        return null;
    }
}

async function testProxy(proxy) {
    try {
        const response = await axios.get('https://api.ipify.org', {
            httpAgent: proxy.agent,
            httpsAgent: proxy.agent,
            timeout: 5000
        });
        logs.log(`- Proxy ${proxy.type} ${proxy.url.split('@')[1] || proxy.url} valid`);
        return true;
    } catch (e) {
        logs.log(`- Proxy ${proxy.type} ${proxy.url.split('@')[1] || proxy.url} invalid: ${e.message}`);
        return false;
    }
}

const generateWallet = () => ethers.Wallet.createRandom();
const saveWallets = (wallets) => fs.writeFileSync('wallets.json', JSON.stringify(wallets, null, 2));
const updateWalletsDisplay = () => {
    const wallets = fs.existsSync('wallets.json') ? JSON.parse(fs.readFileSync('wallets.json')) : [];
    walletsBox.setContent(JSON.stringify(wallets, null, 2));
};

async function makeRequest(method, url, data, retries = 0, usedProxies = new Set(), lastProxy = null) {
    let proxy = retries < MAX_RETRIES ? getRandomProxy(usedProxies) : null;

    if (proxy) {
        const isWorking = await testProxy(proxy);
        if (!isWorking) {
            if (retries < MAX_RETRIES) {
                return makeRequest(method, url, data, retries + 1, usedProxies, lastProxy);
            }
            proxy = null; 
        }
    }

    try {
        const config = {
            method,
            url,
            headers: cleanHeaders(defaultHeaders),
            data,
            ...(proxy ? { httpAgent: proxy.agent, httpsAgent: proxy.agent } : {}),
            timeout: 15000
        };
        
        const res = await axios(config);
        logs.log(`- Proxy: ${proxy ? proxy.type : 'none'}`);
        stats.setContent(`Total: ${stats.total || 0}\nSuccess: ${stats.success || 0}\nFailed: ${stats.failed || 0}\nLast Proxy: ${proxy ? proxy.url : 'none'}`);
        return res.data;
    } catch (e) {
        if (retries < MAX_RETRIES) {
            logs.log(`- Proxy ${proxy ? proxy.type : 'none'} failed: ${e.message}, retry ${retries + 1}/${MAX_RETRIES}`);
            return makeRequest(method, url, data, retries + 1, usedProxies, proxy);
        }
        logs.log(`- Proxy: {red-fg}All retries failed: ${e.message}{/red-fg}`);
        try {
            const config = {
                method,
                url,
                headers: cleanHeaders(defaultHeaders),
                data,
                timeout: 15000
            };
            logs.log('- Fallback: Trying without proxy');
            const res = await axios(config);
            logs.log('- Proxy: none (fallback success)');
            stats.setContent(`Total: ${stats.total || 0}\nSuccess: ${stats.success || 0}\nFailed: ${stats.failed || 0}\nLast Proxy: none`);
            return res.data;
        } catch (fallbackError) {
            logs.log(`- Fallback failed: ${fallbackError.message}`);
            stats.setContent(`Total: ${stats.total || 0}\nSuccess: ${stats.success || 0}\nFailed: ${stats.failed || 0}\nLast Proxy: ${proxy ? proxy.url : 'none'}`);
            return null;
        }
    }
}

async function registerWallet(walletAddress) {
    if (!REFERRAL_CODE) {
        logs.log('{red-fg}Error: No referral code provided{/red-fg}');
        return null;
    }

    return await makeRequest('post', `${BASE_URL}/user`, {
        wallet: walletAddress,
        invite: REFERRAL_CODE
    });
}

async function startNode(walletAddress) {
    return await makeRequest('put', `${BASE_URL}/user/update-start-time`, {
        wallet: walletAddress,
        startTime: Date.now()
    });
}

function startProgram() {
    let total = 0, success = 0, failed = 0;
    stats.total = total;
    stats.success = success;
    stats.failed = failed;
    
    if (!REFERRAL_CODE) {
        logs.log('{red-fg}Cannot start: No referral code in code.txt{/red-fg}');
        return;
    }

    if (proxies.length === 0) {
        logs.log('{yellow-fg}Warning: proxies.txt is empty or not found{/yellow-fg}');
    } else {
        logs.log(`Loaded ${proxies.length} proxies`);
    }

    prompt.show();
    prompt.input('Number of wallets:', '', async (err, value) => {
        prompt.hide();
        const count = parseInt(value);
        if (isNaN(count) || count <= 0) {
            logs.log('{red-fg}Invalid number{/red-fg}');
            screen.render();
            return;
        }

        total = count;
        stats.total = total;
        let wallets = fs.existsSync('wallets.json') ? JSON.parse(fs.readFileSync('wallets.json')) : [];
        logs.log(`Starting ${count} wallets`);
        logs.log(`Using referral code: ${REFERRAL_CODE}`);

        for (let i = 0; i < count; i++) {
            const wallet = generateWallet();
            const addrShort = wallet.address.slice(0, 8) + '...';
            logs.log(`#${i + 1}/${count}: ${addrShort}`);

            const reg = await registerWallet(wallet.address);
            if (reg?.success) {
                logs.log(`- Reg: OK`);
                const start = await startNode(wallet.address);
                if (start?.success) {
                    logs.log(`- Node: ON`);
                    success++;
                    stats.success = success;
                    wallets.push({
                        address: wallet.address,
                        privateKey: wallet.privateKey,
                        createdAt: new Date().toISOString()
                    });
                    saveWallets(wallets);
                    updateWalletsDisplay();
                } else {
                    logs.log(`- Node: {red-fg}FAIL{/red-fg}`);
                    failed++;
                    stats.failed = failed;
                }
            } else {
                logs.log(`- Reg: {red-fg}FAIL{/red-fg}`);
                failed++;
                stats.failed = failed;
            }

            stats.setContent(`Total: ${total}\nSuccess: ${success}\nFailed: ${failed}\nLast Proxy: ${stats.lastProxy || 'none'}`);
            screen.render();
        }

        logs.log(`{cyan-fg}Done!{/cyan-fg}`);
        stats.setContent(`Total: ${total}\nSuccess: ${success}\nFailed: ${failed}\nLast Proxy: ${stats.lastProxy || 'none'}`);
        screen.render();
    });
}

screen.key(['escape', 'q', 'C-c'], () => process.exit(0));

updateWalletsDisplay();
screen.render();
startProgram();
