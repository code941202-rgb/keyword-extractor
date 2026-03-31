require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname)));

// ─── Gemini API 프록시 ──────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  try {
    const apiKey = req.body.apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: 'Gemini API 키가 필요합니다.' });
    }

    const { contents, generationConfig } = req.body;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, generationConfig })
      }
    );

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error('Gemini API 오류:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── 네이버 검색광고 API - 검색량 조회 ──────────────────────────────────────
app.post('/api/search-volume', async (req, res) => {
  try {
    const accessLicense = req.body.accessLicense || process.env.NAVER_AD_ACCESS_LICENSE;
    const secretKey = req.body.secretKey || process.env.NAVER_AD_SECRET_KEY;
    const customerId = req.body.customerId || process.env.NAVER_AD_CUSTOMER_ID;

    if (!accessLicense || !secretKey || !customerId) {
      return res.status(400).json({ error: '네이버 검색광고 API 키가 필요합니다.' });
    }

    const { keywords } = req.body;
    if (!keywords || !keywords.length) {
      return res.status(400).json({ error: '키워드가 필요합니다.' });
    }

    // 네이버 검색광고 API 서명 생성
    const timestamp = String(Date.now());
    const method = 'GET';
    const apiUrl = '/keywordstool';
    const signature = generateSignature(timestamp, method, apiUrl, secretKey);

    // 키워드를 5개씩 나눠서 요청 (API 제한)
    const chunks = [];
    for (let i = 0; i < keywords.length; i += 5) {
      chunks.push(keywords.slice(i, i + 5));
    }

    const allResults = [];
    for (const chunk of chunks) {
      const params = new URLSearchParams({
        hintKeywords: chunk.join(','),
        showDetail: '1'
      });

      const ts = String(Date.now());
      const sig = generateSignature(ts, 'GET', apiUrl, secretKey);

      const naverRes = await fetch(
        `https://api.naver.com/keywordstool?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            'X-Timestamp': ts,
            'X-API-KEY': accessLicense,
            'X-Customer': customerId,
            'X-Signature': sig
          }
        }
      );

      if (!naverRes.ok) {
        const errData = await naverRes.json().catch(() => ({}));
        console.error('네이버 API 오류:', naverRes.status, errData);
        continue;
      }

      const data = await naverRes.json();
      if (data.keywordList) {
        allResults.push(...data.keywordList);
      }

      // API 속도 제한 방지
      await new Promise(r => setTimeout(r, 300));
    }

    res.json({ keywordList: allResults });
  } catch (err) {
    console.error('네이버 검색광고 API 오류:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 네이버 API 서명 생성
function generateSignature(timestamp, method, url, secretKey) {
  const message = `${timestamp}.${method}.${url}`;
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(message);
  return hmac.digest('base64');
}

// ─── 서버 시작 ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ 키워드 추출기 서버 실행 중: http://localhost:${PORT}`);
});
