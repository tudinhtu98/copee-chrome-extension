// Content script for Shopee product pages
// Extracts product data and injects Copee copy button
//
// GIÁ + ẢNH: nhận diện theo thứ tự ưu tiên các nguồn ỔN ĐỊNH (không phụ thuộc
// class CSS bị Shopee băm/đổi theo phiên bản):
//   1. API nội bộ Shopee  /api/v4/pdp/get_pc  (cùng origin, mang cookie) -> bền nhất
//   2. JSON-LD  <script type="application/ld+json"> Product schema
//   3. OG meta tag + quét ảnh CDN susercontent.com  (cứu cánh cuối)
// MÔ TẢ + DANH MỤC: vẫn dùng class ngữ nghĩa (product-detail / breadcrumb) vốn ổn định.

(function() {
  'use strict';

  // ============================================================
  // Helpers chung
  // ============================================================

  // Convert DOM element to text preserving line breaks
  function extractTextWithLineBreaks(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    clone.querySelectorAll('div, p, li, tr, h1, h2, h3, h4, h5, h6').forEach(el => {
      el.prepend('\n');
    });
    let text = clone.textContent || '';
    text = text
      .split('\n')
      .map(line => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n');
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    return text;
  }

  // Lấy shopId / itemId từ URL Shopee dạng .../ten-san-pham-i.{shopId}.{itemId}
  function getShopeeIds() {
    const m = window.location.pathname.match(/-i\.(\d+)\.(\d+)/);
    if (m) return { shopId: m[1], itemId: m[2] };
    return null;
  }

  // Dựng URL ảnh CDN từ hash (hoặc trả nguyên nếu đã là URL đầy đủ)
  function shopeeImageUrl(hashOrUrl) {
    if (!hashOrUrl) return null;
    if (hashOrUrl.startsWith('http')) return hashOrUrl.split('?')[0];
    return `https://down-vn.img.susercontent.com/file/${hashOrUrl}`;
  }

  // Thêm ảnh vào data.images, khử trùng lặp theo hash/file id
  function makeImageAdder(data) {
    const seen = new Set();
    function addImage(hashOrUrl) {
      const url = shopeeImageUrl(hashOrUrl);
      if (!url) return false;
      const idMatch = url.match(/\/file\/([a-zA-Z0-9-_]+)/);
      const key = idMatch ? idMatch[1] : url;
      // Ảnh cover của VIDEO (hash kết thúc _cover) -> không phải ảnh sản phẩm, bỏ
      if (key.endsWith('_cover') || key.includes('_cover@')) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      data.images.push(url);
      return true;
    }
    addImage.__count = () => data.images.length;
    return addImage;
  }

  // ============================================================
  // NGUỒN 1: API nội bộ Shopee (ưu tiên cao nhất cho GIÁ + ẢNH)
  // ============================================================

  async function fetchShopeeApiItem(ids) {
    const url = `https://shopee.vn/api/v4/pdp/get_pc?item_id=${ids.itemId}&shop_id=${ids.shopId}&detail_level=0`;
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'accept': 'application/json',
        'x-api-source': 'pc',
        'x-shopee-language': 'vi',
        'x-requested-with': 'XMLHttpRequest',
        'af-ac-enc-dat': '',
      },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    // Shopee thường trả HTTP 200 kèm error trong body khi bị chặn anti-bot
    if (json && json.error) {
      throw new Error('API error=' + json.error + ' ' + (json.error_msg || ''));
    }
    // Cấu trúc: { data: { item: {...} } }  (một số phiên bản trả thẳng { item })
    const item = json?.data?.item || json?.item || json?.data;
    if (!item || (item.price == null && item.price_min == null && !item.title)) {
      throw new Error('No item in API response');
    }
    return item;
  }

  // Giá trong API Shopee được nhân 100000 (micro-unit) -> chia lại ra VND
  function shopeePriceToVnd(raw) {
    if (raw == null) return null;
    const n = Number(raw);
    if (!isFinite(n) || n <= 0) return null;
    return Math.round(n / 100000);
  }

  function applyApiItem(item, data, addImage) {
    if (item.title && !data.title) data.title = String(item.title).trim();

    // Giá hiện tại (đã giảm): ưu tiên price, sau đó price_min
    const current = shopeePriceToVnd(item.price) ?? shopeePriceToVnd(item.price_min);
    // Giá gốc (trước giảm)
    const before = shopeePriceToVnd(item.price_before_discount);

    if (current) data.price = current;
    if (before && (!current || before > current)) data.originalPrice = before;
    // Có giá gốc mà không có giá hiện tại -> dùng giá gốc làm hiện tại
    if (before && !current) data.price = before;

    // Ảnh: item.images là mảng hash đầy đủ; item.image là ảnh chính
    const imgs = Array.isArray(item.images) && item.images.length
      ? item.images
      : (item.image ? [item.image] : []);
    imgs.forEach(addImage);

    console.log('[Copee] API item ->', {
      title: data.title, price: data.price, originalPrice: data.originalPrice,
      images: data.images.length,
    });
  }

  // ============================================================
  // NGUỒN 2: JSON-LD (Product schema)
  // ============================================================

  function applyJsonLd(data, addImage) {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let parsed;
      try { parsed = JSON.parse(script.textContent); } catch (e) { continue; }

      // Có thể là object đơn, mảng, hoặc @graph
      const candidates = [];
      const collect = (node) => {
        if (!node) return;
        if (Array.isArray(node)) { node.forEach(collect); return; }
        if (node['@graph']) collect(node['@graph']);
        candidates.push(node);
      };
      collect(parsed);

      const product = candidates.find(n => {
        const t = n && n['@type'];
        return t === 'Product' || (Array.isArray(t) && t.includes('Product'));
      });
      if (!product) continue;

      if (product.name && !data.title) data.title = String(product.name).trim();

      // Ảnh: string | array
      if (product.image) {
        const imgs = Array.isArray(product.image) ? product.image : [product.image];
        imgs.forEach(addImage);
      }

      // Giá: offers có thể là Offer hoặc AggregateOffer
      const offers = product.offers;
      const offerList = Array.isArray(offers) ? offers : (offers ? [offers] : []);
      for (const offer of offerList) {
        const price = Number(offer.price ?? offer.lowPrice);
        const high = Number(offer.highPrice);
        if (isFinite(price) && price > 0 && !data.price) data.price = Math.round(price);
        if (isFinite(high) && high > 0 && data.price && high > data.price) {
          data.originalPrice = Math.round(high);
        }
      }
      console.log('[Copee] JSON-LD ->', {
        title: data.title, price: data.price, images: data.images.length,
      });
      return; // đã tìm thấy Product
    }
  }

  // ============================================================
  // NGUỒN 3: OG meta + quét ảnh trên trang (cứu cánh cuối)
  // ============================================================

  function metaContent(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const c = el && (el.getAttribute('content') || el.getAttribute('value'));
      if (c && c.trim()) return c.trim();
    }
    return null;
  }

  function applyMetaAndDom(data, addImage) {
    if (!data.title) {
      const t = metaContent(['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
                (document.querySelector('h1')?.textContent || '').trim();
      if (t) data.title = t;
    }

    if (!data.price) {
      const p = metaContent([
        'meta[property="product:price:amount"]',
        'meta[itemprop="price"]',
        'meta[property="og:price:amount"]',
      ]);
      const n = p ? parseInt(p.replace(/[^0-9]/g, ''), 10) : NaN;
      if (isFinite(n) && n > 0) data.price = n;
    }

    // Nếu vẫn chưa có giá: quét text chứa '₫' gần đầu trang
    if (!data.price) {
      const priceRegex = /(\d[\d.,]*)\s*(?:₫|đ|VND)/i;
      const nodes = document.querySelectorAll('div, span');
      for (const node of nodes) {
        if (node.children.length > 3) continue; // chỉ node lá chứa text giá
        const m = (node.textContent || '').match(priceRegex);
        if (m) {
          const n = parseInt(m[1].replace(/[^0-9]/g, ''), 10);
          if (isFinite(n) && n >= 1000) { data.price = n; break; }
        }
      }
    }

    // Ảnh chính từ og:image
    if (data.images.length === 0) {
      const ogImg = metaContent(['meta[property="og:image"]', 'meta[name="twitter:image"]']);
      if (ogImg) addImage(ogImg);
    }

    // Quét toàn trang các ảnh CDN Shopee (không phụ thuộc class)
    if (data.images.length === 0) {
      document.querySelectorAll('img[src*="susercontent.com"], img[src*="cf.shopee"]').forEach(img => {
        if (img.closest('video')) return;
        const src = img.getAttribute('src');
        if (src && src.includes('/file/')) addImage(src);
      });
    }
  }

  // Gom ảnh GALLERY từ DOM (chỉ dùng bù khi API Shopee bị chặn).
  // Quét rộng nhưng loại nhiễu bằng 2 dấu hiệu ỔN ĐỊNH:
  //   (a) chỉ lấy ảnh nằm TRÊN phần mô tả/đánh giá  -> bỏ review & sản phẩm gợi ý
  //   (b) bỏ ảnh nằm trong LINK điều hướng (a[href])-> bỏ avatar/logo shop,
  //       vì thumbnail gallery KHÔNG phải link (bấm vào chỉ đổi ảnh chính).
  function collectGalleryImages(addImage) {
    const startCount = addImage.__count();

    // Mốc ranh giới dưới của gallery = phần mô tả / khu đánh giá (nằm dưới gallery)
    const boundary = document.querySelector(
      'div.product-detail.page-product__detail, [class*="product-rating"], ' +
      '[class*="product-comment"], .product-ratings, [class*="rating-overview"]'
    );
    const beforeBoundary = (el) => {
      if (!boundary) return true;
      return !!(boundary.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
    };

    const isBad = (el) => {
      if (!beforeBoundary(el)) return true; // nằm dưới mô tả/đánh giá
      if (el.closest('[class*="rating" i], [class*="comment" i], [class*="review" i]')) return true;
      const a = el.closest('a[href]');
      if (a) {
        const href = a.getAttribute('href') || '';
        // link điều hướng thật (avatar/logo shop, sản phẩm gợi ý) -> bỏ.
        // Thumbnail gallery không có href thật (# hoặc javascript) nên vẫn giữ.
        if (href && href !== '#' && !href.startsWith('javascript')) return true;
      }
      return false;
    };

    const pushFromNode = (node) => {
      if (isBad(node)) return;
      const img = node.tagName === 'IMG' ? node : node.querySelector('img');
      const srcs = [];
      if (img) srcs.push(img.getAttribute('src'), img.getAttribute('data-src'), img.getAttribute('data-lazy-src'));
      if (node.querySelectorAll) {
        node.querySelectorAll('source').forEach(s => {
          const ss = s.getAttribute('srcset');
          if (ss) srcs.push(ss.split(',')[0].trim().split(' ')[0]);
        });
      }
      srcs.forEach(src => {
        if (src && src.includes('susercontent.com') && src.includes('/file/')) addImage(src);
      });
    };

    // CHỈ lấy ảnh trong <picture> (ảnh chính + thumbnail đều nằm trong <picture>).
    // Ảnh <img> trần ngoài <picture> là overlay (class ZUEJdQ) -> không lấy.
    document.querySelectorAll('picture').forEach(pushFromNode);

    document.querySelectorAll('[style*="susercontent.com"]').forEach(el => {
      if (isBad(el)) return;
      const m = (el.getAttribute('style') || '').match(/url\(["']?([^"')]+susercontent\.com[^"')]+)["']?\)/);
      if (m && m[1].includes('/file/')) addImage(m[1]);
    });

    console.log('[Copee] Gallery DOM ->', {
      co_boundary: !!boundary, thu_them: addImage.__count() - startCount,
    });
  }

  // ============================================================
  // MÔ TẢ (giữ nguyên logic cũ, dựa vào class ngữ nghĩa ổn định)
  // ============================================================

  function extractDescription() {
    let description = '';

    // Strategy 0: selector ưu tiên (section:nth-child(4))
    try {
      const prioritySelector = '#sll2-normal-pdp-main > div > div > div > div.container > div.wAMdpk > div > div.page-product__content--left > div.product-detail.page-product__detail > section:nth-child(4) > div > div > div';
      const priorityDescDiv = document.querySelector(prioritySelector);
      if (priorityDescDiv) {
        const divClone = priorityDescDiv.cloneNode(true);
        divClone.querySelectorAll('h2').forEach(h2 => h2.remove());
        const t = extractTextWithLineBreaks(divClone);
        if (t.length > 50) description = t;
      }
    } catch (e) { /* noop */ }

    // Strategy 1: product-detail container -> section:nth-child(2)
    if (!description || description.trim().length < 50) {
      try {
        const exactSelector = 'div.page-product__content--left > div.product-detail.page-product__detail > section:nth-child(2) > div';
        let descriptionDiv = document.querySelector(exactSelector);
        if (!descriptionDiv) {
          const productDetailContainer = document.querySelector('div.product-detail.page-product__detail');
          if (productDetailContainer) {
            const secondSection = productDetailContainer.querySelector('section:nth-child(2)');
            if (secondSection) descriptionDiv = secondSection.querySelector('div');
          }
        }
        if (!descriptionDiv) {
          const productDetail = document.querySelector('#sll2-normal-pdp-main div.product-detail.page-product__detail');
          if (productDetail) {
            const sections = productDetail.querySelectorAll('section');
            if (sections.length > 1) descriptionDiv = sections[1].querySelector('div');
          }
        }
        if (descriptionDiv) {
          const divClone = descriptionDiv.cloneNode(true);
          divClone.querySelectorAll('h2').forEach(h2 => h2.remove());
          const t = extractTextWithLineBreaks(divClone);
          if (t.length > 50) description = t;
        }
      } catch (e) { /* noop */ }
    }

    // Strategy 2: các container mô tả phổ biến
    if (!description || description.trim().length < 100) {
      const selectors = [
        '[data-testid="product-description"]',
        '.product-detail__content',
        '.product-detail__content-wrapper',
        '[class*="product-detail"] [class*="content"]',
        '[class*="product-detail"] [class*="description"]',
        '.shopee-product-detail',
        '#product-detail',
      ];
      for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
          const text = extractTextWithLineBreaks(element);
          if (text.trim().length > 100 &&
              !text.match(/^(Mô tả sản phẩm|Thông tin sản phẩm|Chi tiết sản phẩm)\s*:?\s*$/i)) {
            if (text.split(/\s+/).length > 20 && text.length > description.length) description = text;
          }
        }
        if (description.length > 300) break;
      }
    }

    // Clean up + limit
    if (description) {
      description = description
        .replace(/^Mô tả sản phẩm\s*:?\s*/i, '')
        .replace(/^Thông tin sản phẩm\s*:?\s*/i, '')
        .replace(/^Chi tiết sản phẩm\s*:?\s*/i, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (description.length > 5000) description = description.substring(0, 5000) + '...';
    }
    return description;
  }

  // ============================================================
  // DANH MỤC (giữ nguyên logic cũ)
  // ============================================================

  function extractCategory() {
    let category = '';
    const breadcrumbSelectors = [
      'nav[aria-label*="breadcrumb"] a', '.breadcrumb a', '[data-testid="breadcrumb"] a',
      '[class*="breadcrumb"] a', 'ol[class*="breadcrumb"] a', 'ul[class*="breadcrumb"] a',
      '.shopee-breadcrumb a',
    ];
    let links = [];
    for (const selector of breadcrumbSelectors) {
      links = Array.from(document.querySelectorAll(selector));
      if (links.length > 0) break;
    }
    if (links.length > 0) {
      const generic = ['trang chủ', 'home', 'sản phẩm', 'products', 'shopee', 'shop'];
      const valid = links.filter(l => {
        const t = l.textContent.trim().toLowerCase();
        return !generic.includes(t) && t.length > 0;
      });
      if (valid.length > 0) category = valid[valid.length - 1].textContent.trim();
    }

    if (!category) {
      const catLinks = Array.from(document.querySelectorAll('a[href*="/category/"]')).filter(l => {
        const t = l.textContent.trim();
        return t.length > 0 && !t.match(/^(Danh mục|Category|Phân loại|Trang chủ|Home)$/i);
      });
      if (catLinks.length > 0) category = catLinks[catLinks.length - 1].textContent.trim();
    }

    if (!category) {
      const urlMatch = window.location.href.match(/\/category\/([^\/\?]+)/);
      if (urlMatch) {
        category = decodeURIComponent(urlMatch[1]).replace(/-/g, ' ')
          .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      }
    }
    return category ? category.trim().replace(/\s+/g, ' ') : '';
  }

  // ============================================================
  // LIVE DOM: tên + giá của SẢN PHẨM ĐANG HIỂN THỊ (luôn đúng khi SPA)
  // ============================================================

  // Quét giá đang hiển thị: current (giá bán) + original (giá gạch ngang).
  function scanLivePrices() {
    const boundary = document.querySelector(
      'div.product-detail.page-product__detail, [class*="product-rating"], [class*="product-comment"]'
    );
    const beforeB = (el) => !boundary || (boundary.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
    const re = /(\d[\d.]{2,})\s*(?:₫|đ)/;
    let current = null, original = null;

    for (const el of document.querySelectorAll('div, span')) {
      if (el.children.length > 0) continue;         // chỉ node lá chứa text giá
      if (el.closest('header, nav')) continue;      // bỏ giá quảng cáo ở header
      if (!beforeB(el)) continue;                   // chỉ vùng trên mô tả/đánh giá
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length > 20) continue;
      const m = txt.match(re);
      if (!m) continue;
      const n = parseInt(m[1].replace(/\D/g, ''), 10);
      if (!(n >= 1000)) continue;
      let struck = false;
      try { struck = window.getComputedStyle(el).textDecorationLine.includes('line-through'); } catch (e) { /* noop */ }
      if (struck) { if (!original || n > original) original = n; }
      else if (!current) { current = n; }
      if (current && original) break;
    }
    return { current, original };
  }

  function applyLiveDom(data) {
    if (!data.title) {
      let h1 = (document.querySelector('h1')?.textContent || '').trim().replace(/^\s*Yêu thích\s*/i, '').trim();
      if (h1) data.title = h1;
    }
    if (!data.price) {
      const p = scanLivePrices();
      if (p.current) data.price = p.current;
      if (p.original && (!p.current || p.original > p.current)) data.originalPrice = p.original;
    }
    console.log('[Copee] Live DOM ->', {
      title: data.title, price: data.price, originalPrice: data.originalPrice,
    });
  }

  // ============================================================
  // Orchestrator: gộp dữ liệu từ nhiều nguồn
  // ============================================================

  async function extractProductData() {
    const sourceUrl = window.location.origin + window.location.pathname;
    const data = {
      title: '', price: 0, originalPrice: undefined,
      images: [], description: '', category: '', sourceUrl,
    };
    const addImage = makeImageAdder(data);

    try {
      const ids = getShopeeIds();

      // Nguồn 1: API nội bộ Shopee
      if (ids) {
        try {
          const item = await fetchShopeeApiItem(ids);
          applyApiItem(item, data, addImage);
        } catch (e) {
          console.warn('[Copee] Nguồn API thất bại:', e.message);
        }
      }

      // Nguồn 2: LIVE DOM (dữ liệu của SẢN PHẨM ĐANG XEM — luôn cập nhật kể cả
      // khi Shopee điều hướng SPA). Ưu tiên hơn JSON-LD/meta vì 2 nguồn đó KHÔNG
      // đổi theo điều hướng SPA (giữ nguyên sản phẩm đầu tiên -> gây dính đồ cũ).
      try { applyLiveDom(data); } catch (e) { console.warn('[Copee] Live DOM lỗi:', e.message); }

      // Ảnh gallery từ <picture> hiện tại (chỉ khi API chưa cho đủ ảnh).
      if (data.images.length < 2) {
        try { collectGalleryImages(addImage); } catch (e) { console.warn('[Copee] Gallery lỗi:', e.message); }
      }

      // Nguồn 3: JSON-LD (CHỐT CUỐI — có thể cũ khi SPA, chỉ bù khi vẫn trống)
      if (!data.title || !data.price || data.images.length === 0) {
        try { applyJsonLd(data, addImage); } catch (e) { console.warn('[Copee] JSON-LD lỗi:', e.message); }
      }

      // Nguồn 4: OG meta (CHỐT CUỐI — cũng có thể cũ khi SPA)
      if (!data.title || !data.price || data.images.length === 0) {
        try { applyMetaAndDom(data, addImage); } catch (e) { console.warn('[Copee] Meta/DOM lỗi:', e.message); }
      }

      // Mô tả + danh mục
      data.description = extractDescription();
      data.category = extractCategory();

      console.log('[Copee] Kết quả cuối:', {
        title: data.title || '(no title)',
        price: data.price || 0,
        originalPrice: data.originalPrice || '(none)',
        category: data.category || '(no category)',
        descriptionLength: data.description?.length || 0,
        imagesCount: data.images?.length || 0,
        sourceUrl: data.sourceUrl,
      });
    } catch (error) {
      console.error('[Copee] Lỗi extractProductData:', error);
    }

    return data;
  }

  // ============================================================
  // Gửi dữ liệu về background / popup
  // ============================================================

  function safeSendMessage(message, callback) {
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        if (callback) callback({ error: 'Chrome runtime not available' });
        return;
      }
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError.message;
          if (error && error.includes('Extension context invalidated')) {
            if (window.copeeExtractTimeout) clearTimeout(window.copeeExtractTimeout);
          }
          if (callback) callback({ error });
        } else if (callback) {
          callback(response);
        }
      });
    } catch (error) {
      if (callback) callback({ error: error.message });
    }
  }

  let extractionAttempts = 0;
  const maxAttempts = 10;

  async function tryExtractWithRetry() {
    extractionAttempts++;
    const productData = await extractProductData();

    console.log(`[Copee] Lần quét ${extractionAttempts}/${maxAttempts}:`, {
      hasTitle: !!productData.title,
      hasPrice: productData.price > 0,
      hasImages: productData.images?.length > 0,
    });

    const hasTitle = productData.title && productData.title.trim().length > 0;
    const hasPrice = productData.price > 0;

    // Gửi khi có tối thiểu title; nếu còn thiếu giá thì vẫn thử lại thêm cho đủ
    if (hasTitle && (hasPrice || extractionAttempts >= maxAttempts)) {
      safeSendMessage({ action: 'productData', data: productData });
    } else if (extractionAttempts < maxAttempts) {
      setTimeout(tryExtractWithRetry, 500);
    } else {
      safeSendMessage({ action: 'productData', data: productData });
    }
  }

  // Khởi động
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryExtractWithRetry, 500));
  } else {
    setTimeout(tryExtractWithRetry, 500);
  }

  // Re-extract khi DOM thay đổi nhiều (nội dung động)
  const observer = new MutationObserver((mutations) => {
    let shouldReExtract = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1 && node.querySelector && (
          node.querySelector('.product-detail') ||
          node.querySelector('[class*="product-detail"]') ||
          node.classList.contains('product-detail')
        )) { shouldReExtract = true; break; }
      }
      if (shouldReExtract) break;
    }
    if (shouldReExtract && extractionAttempts < maxAttempts) {
      clearTimeout(window.copeeExtractTimeout);
      window.copeeExtractTimeout = setTimeout(tryExtractWithRetry, 1000);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // SPA: Shopee đổi URL KHÔNG reload trang -> content script không chạy lại.
  // Theo dõi URL đổi để tự quét lại sản phẩm mới (reset để không dính dữ liệu cũ).
  let __copeeLastHref = location.href;
  function onUrlMaybeChanged() {
    if (location.href === __copeeLastHref) return;
    __copeeLastHref = location.href;
    console.log('[Copee] URL đổi -> quét lại sản phẩm mới');
    extractionAttempts = 0;
    clearTimeout(window.copeeExtractTimeout);
    // Chờ DOM sản phẩm mới render xong mới quét (tránh dính ảnh/giá sản phẩm cũ)
    window.copeeExtractTimeout = setTimeout(tryExtractWithRetry, 1200);
  }
  ['pushState', 'replaceState'].forEach(fn => {
    const orig = history[fn];
    history[fn] = function () { const r = orig.apply(this, arguments); onUrlMaybeChanged(); return r; };
  });
  window.addEventListener('popstate', onUrlMaybeChanged);
  setInterval(onUrlMaybeChanged, 600); // fallback nếu bỏ sót

  // Popup yêu cầu quét lại
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractProduct') {
      extractionAttempts = 0;
      tryExtractWithRetry();
      sendResponse({ success: true });
    }
    return true;
  });

  console.log('Copee: Product data extractor loaded (v2 - resilient price/image)');
})();
