const crypto = require('crypto');

// --- Configuration ---
const DOMAIN = process.env.CONFLUENCE_DOMAIN || 'ugurdogan.atlassian.net';
const EMAIL = process.env.CONFLUENCE_EMAIL;
const API_TOKEN = process.env.CONFLUENCE_API_TOKEN;

const SPACES_TO_CREATE = parseInt(process.env.SPACES_TO_CREATE || '2', 10);
const PAGES_PER_SPACE = parseInt(process.env.PAGES_PER_SPACE || '1000', 10);
const CONCURRENCY_LIMIT = 10; // Eşzamanlı oluşturulacak sayfa sayısı

if (!EMAIL || !API_TOKEN) {
    console.error('HATA: CONFLUENCE_EMAIL ve CONFLUENCE_API_TOKEN ortam değişkenleri gerekli.');
    console.error('Kullanım örneği (PowerShell):');
    console.error('  $env:CONFLUENCE_EMAIL="mailiniz@example.com"');
    console.error('  $env:CONFLUENCE_API_TOKEN="api_token_buraya"');
    console.error('  node scale-test.js');
    process.exit(1);
}

const authHeader = 'Basic ' + Buffer.from(`${EMAIL}:${API_TOKEN}`).toString('base64');
const baseUrl = `https://${DOMAIN}`;

// Delay helper (Bekleme)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 429 Rate Limit destekli Fetch
async function fetchWithRetry(url, options, retries = 5) {
    for (let i = 0; i < retries; i++) {
        const response = await fetch(url, options);
        if (response.ok) {
            return await response.json();
        }
        
        if (response.status === 429) {
            const retryAfter = response.headers.get('retry-after');
            // Eğer retry-after header'ı varsa o kadar, yoksa exponential backoff (2^i saniye) bekle
            const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : (2 ** i) * 1000;
            console.log(`[Rate Limit - 429] Bekleniyor: ${waitTime}ms... (${url})`);
            await delay(waitTime);
            continue;
        }

        const errorText = await response.text();
        throw new Error(`API Hatası: ${response.status} ${response.statusText} - ${errorText}`);
    }
    throw new Error(`Maksimum tekrar deneme sayısına ulaşıldı (${url}).`);
}

async function createSpace(spaceKey, spaceName) {
    console.log(`Space oluşturuluyor: ${spaceName} (${spaceKey})`);
    const url = `${baseUrl}/wiki/rest/api/space`;
    const payload = {
        key: spaceKey,
        name: spaceName,
        description: {
            plain: { value: "Scale test amaçlı otomatik oluşturulmuş alan", representation: "plain" }
        }
    };
    
    const data = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    
    console.log(`Space başarıyla oluşturuldu. ID: ${data.id}`);
    return data.id; // v2 page api spaceKey yerine spaceId kullanır
}

async function createPage(spaceId, title, content) {
    const url = `${baseUrl}/wiki/api/v2/pages`;
    const payload = {
        spaceId: spaceId.toString(),
        status: 'current',
        title: title,
        body: {
            representation: 'storage',
            value: content
        }
    };
    
    return await fetchWithRetry(url, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
    });
}

// Asenkron işlemleri belirli bir limit dahilinde (batch) işlemek için yardımcı fonksiyon
async function processInBatches(tasks, limit) {
    let results = [];
    let executing = [];
    for (const task of tasks) {
        const p = Promise.resolve().then(() => task());
        results.push(p);
        
        if (limit <= tasks.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= limit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(results);
}

async function run() {
    console.log(`--- Confluence Scale Test Başlıyor ---`);
    console.log(`Hedef Domain: ${DOMAIN}`);
    console.log(`Oluşturulacak Space Sayısı: ${SPACES_TO_CREATE}`);
    console.log(`Space Başına Sayfa Sayısı: ${PAGES_PER_SPACE}`);
    
    for (let i = 1; i <= SPACES_TO_CREATE; i++) {
        const uniqueSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
        const spaceKey = `SCALE${i}${uniqueSuffix}`;
        const spaceName = `Scale Test Space ${i} (${uniqueSuffix})`;
        
        let spaceId;
        try {
            spaceId = await createSpace(spaceKey, spaceName);
        } catch (error) {
            console.error(`Space oluşturma hatası (${spaceKey}):`, error.message);
            continue;
        }
        
        console.log(`[Space ${i}/${SPACES_TO_CREATE}] Sayfalar oluşturuluyor... (Hedef: ${PAGES_PER_SPACE} sayfa)`);
        
        let successCount = 0;
        let failCount = 0;
        
        const pageTasks = [];
        for (let j = 1; j <= PAGES_PER_SPACE; j++) {
            pageTasks.push(async () => {
                const title = `Test Document ${j} - ${spaceKey}`;
                const content = `<p>This is a test document created for scale testing. Document number: ${j}</p>
                <p>Scale test sırasında Attestly app performansını ölçmek ve UI tepki sürelerini incelemek için üretilmiştir.</p>
                <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>`;
                
                try {
                    await createPage(spaceId, title, content);
                    successCount++;
                    if (successCount % 50 === 0) {
                        console.log(`  -> Gidişat: ${successCount} sayfa başarıyla eklendi...`);
                    }
                } catch (err) {
                    failCount++;
                    console.error(`  -> Sayfa hatası (${title}):`, err.message);
                }
            });
        }
        
        const startTime = Date.now();
        await processInBatches(pageTasks, CONCURRENCY_LIMIT);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        console.log(`[Space ${i}/${SPACES_TO_CREATE}] Tamamlandı! Başarılı: ${successCount}, Hatalı: ${failCount}, Süre: ${duration} sn`);
    }
    
    console.log(`--- Test Tamamlandı ---`);
}

run().catch(console.error);
