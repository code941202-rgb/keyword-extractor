require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname)));

// ─── URL 크롤링 API ─────────────────────────────────────────────────────────
app.post('/api/crawl', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL이 필요합니다.' });

    // 네이버 스마트스토어 전용 처리
    const smartstoreMatch = url.match(/smartstore\.naver\.com\/([^/]+)\/products\/(\d+)/);
    if (smartstoreMatch) {
      const productId = smartstoreMatch[2];
      const storeName = smartstoreMatch[1];

      // 방법 1: 네이버 쇼핑 상품 API
      try {
        const apiRes = await fetch(
          `https://shopping.naver.com/shopv/api/catalog/product/${productId}`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Accept': 'application/json',
              'Referer': `https://shopping.naver.com/`
            }
          }
        );
        if (apiRes.ok) {
          const data = await apiRes.json();
          const p = data.product || data.catalogProduct || data;
          const productText = [
            p.name && `상품명: ${p.name}`,
            p.productName && `상품명: ${p.productName}`,
            p.category && `카테고리: ${typeof p.category === 'object' ? (p.category.wholeCategoryName || p.category.categoryName || JSON.stringify(p.category)) : p.category}`,
            p.salePrice && `가격: ${p.salePrice}원`,
            p.price && `가격: ${p.price}원`,
          ].filter(Boolean).join('\n');

          if (productText.length > 10) {
            return res.json({
              productText,
              info: { title: p.name || p.productName || '', description: '', price: p.salePrice || p.price || '', category: '' }
            });
          }
        }
      } catch (e) {
        console.error('네이버 쇼핑 API 실패:', e.message);
      }

      // 방법 2: 스마트스토어 내부 API (여러 엔드포인트 시도)
      const apiUrls = [
        `https://smartstore.naver.com/i/v1/contents/products/${productId}`,
        `https://m.smartstore.naver.com/i/v1/contents/products/${productId}`,
      ];

      for (const apiUrl of apiUrls) {
        try {
          const apiRes = await fetch(apiUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
              'Accept': 'application/json',
              'Referer': url
            }
          });
          if (apiRes.ok) {
            const data = await apiRes.json();
            const p = data.product || data;
            const productText = [
              p.name && `상품명: ${p.name}`,
              p.category && `카테고리: ${typeof p.category === 'object' ? (p.category.wholeCategoryName || JSON.stringify(p.category)) : p.category}`,
              p.salePrice && `가격: ${p.salePrice}원`,
              p.productInfoProvidedNotice && `상품정보: ${JSON.stringify(p.productInfoProvidedNotice).substring(0, 1500)}`,
              p.detailAttribute && `속성: ${JSON.stringify(p.detailAttribute).substring(0, 1500)}`,
              p.naverShoppingSearchInfo && `검색정보: ${JSON.stringify(p.naverShoppingSearchInfo)}`,
              p.tags && `태그: ${Array.isArray(p.tags) ? p.tags.join(', ') : p.tags}`
            ].filter(Boolean).join('\n');

            if (productText.length > 10) {
              return res.json({
                productText,
                info: { title: p.name || '', description: '', price: p.salePrice || '', category: '' }
              });
            }
          }
        } catch (e) {
          console.error(`API ${apiUrl} 실패:`, e.message);
        }
      }

      // 방법 3: 모바일 페이지 크롤링 (차단 우회)
      try {
        const mobileRes = await fetch(`https://m.smartstore.naver.com/${storeName}/products/${productId}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ko-KR,ko;q=0.9'
          }
        });
        if (mobileRes.ok) {
          const html = await mobileRes.text();
          const $ = cheerio.load(html);

          // script 태그에서 __NEXT_DATA__ 또는 상품 JSON 추출
          let productData = null;
          $('script').each((i, el) => {
            const text = $(el).html() || '';
            if (text.includes('__NEXT_DATA__')) {
              try {
                const match = text.match(/__NEXT_DATA__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script/);
                if (match) productData = JSON.parse(match[1]);
              } catch(e) {}
            }
            if (text.includes('"product"') && text.includes('"name"')) {
              try {
                const jsonMatch = text.match(/\{[\s\S]*"product"[\s\S]*"name"[\s\S]*\}/);
                if (jsonMatch) productData = JSON.parse(jsonMatch[0]);
              } catch(e) {}
            }
          });

          const title = $('meta[property="og:title"]').attr('content') || $('title').text() || '';
          const desc = $('meta[property="og:description"]').attr('content') || '';
          const keywords = $('meta[name="keywords"]').attr('content') || '';

          if (title) {
            const productText = [
              `상품명: ${title}`,
              desc && `설명: ${desc}`,
              keywords && `키워드: ${keywords}`,
            ].filter(Boolean).join('\n');

            return res.json({
              productText,
              info: { title, description: desc, price: '', category: '' }
            });
          }
        }
      } catch (e) {
        console.error('모바일 크롤링 실패:', e.message);
      }
    }

    // 네이버 쇼핑 상품 (shopping.naver.com)
    const shoppingMatch = url.match(/shopping\.naver\.com\/.*?[\?&]?(?:nvMid=|products\/)(\d+)/);

    // 일반 크롤링
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `페이지 로드 실패 (${response.status})` });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const info = {
      title: '',
      description: '',
      price: '',
      category: '',
      details: ''
    };

    info.title = $('meta[property="og:title"]').attr('content')
      || $('meta[name="title"]').attr('content')
      || $('title').text()
      || '';

    info.description = $('meta[property="og:description"]').attr('content')
      || $('meta[name="description"]').attr('content')
      || '';

    info.price = $('meta[property="product:price:amount"]').attr('content')
      || $('[class*="price"]').first().text().trim()
      || '';

    info.category = $('meta[property="product:category"]').attr('content')
      || $('[class*="category"]').first().text().trim()
      || '';

    $('script, style, nav, header, footer').remove();
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 3000);
    info.details = bodyText;

    const keywords = $('meta[name="keywords"]').attr('content') || '';

    const productText = [
      info.title && `상품명: ${info.title}`,
      info.description && `설명: ${info.description}`,
      info.price && `가격: ${info.price}`,
      info.category && `카테고리: ${info.category}`,
      keywords && `키워드: ${keywords}`,
      info.details && `페이지 내용: ${info.details.substring(0, 2000)}`
    ].filter(Boolean).join('\n');

    res.json({ productText, info });
  } catch (err) {
    console.error('크롤링 오류:', err.message);
    res.status(500).json({ error: `크롤링 실패: ${err.message}` });
  }
});

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
        `https://api.searchad.naver.com/keywordstool?${params.toString()}`,
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
