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

  // Dữ liệu sản phẩm mới nhất đã quét (dùng cho nút float copy nhanh)
  let __copeeLatestData = null;

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
  // NÚT FLOAT: copy nhanh ngay trên trang Shopee (Shadow DOM để cô lập CSS)
  // ============================================================

  const FAB_HOST_ID = 'copee-fab-host';
  let __fabRoot = null;      // shadow root
  let __fabEls = null;       // { wrap, fab, panel, title, price, copyBtn, status, minimizeBtn }
  let __fabBusy = false;     // đang copy -> chặn double click
  let __fabEnabled = true;   // bật/tắt từ settings (storage.floatButtonEnabled)
  let __fabMinimized = false;
  let __fabDragged = false;  // vừa kéo -> chặn click ngay sau đó
  let __fabPos = null;       // vị trí tuỳ chỉnh {right, bottom} (null = neo mặc định)

  // Trang này có phải trang sản phẩm Shopee không (có -i.shopId.itemId)
  function isProductPage() {
    return !!getShopeeIds();
  }

  function buildFab() {
    if (document.getElementById(FAB_HOST_ID)) return;

    const host = document.createElement('div');
    host.id = FAB_HOST_ID;
    // Bám vào documentElement để tồn tại kể cả khi Shopee thay body
    (document.documentElement || document.body).appendChild(host);

    const root = host.attachShadow({ mode: 'open' });
    __fabRoot = root;

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .wrap {
        position: fixed; right: 20px; bottom: 96px; z-index: 2147483647;
        display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
      }
      /* Nút tròn (trạng thái thu gọn) */
      .fab {
        width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: #fff; display: flex; align-items: center; justify-content: center;
        box-shadow: 0 6px 20px rgba(102,126,234,.45); transition: transform .15s, box-shadow .15s;
      }
      .fab:hover { transform: translateY(-2px); box-shadow: 0 8px 26px rgba(102,126,234,.6); }
      .fab svg { width: 26px; height: 26px; }
      .fab.hidden { display: none; }
      /* Bảng (trạng thái mở rộng) */
      .panel {
        width: 300px; background: #fff; border-radius: 14px; overflow: hidden;
        box-shadow: 0 10px 40px rgba(0,0,0,.22); border: 1px solid #eee;
      }
      .panel.hidden { display: none; }
      .panel-head {
        display: flex; align-items: center; gap: 8px; padding: 12px 14px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff;
        cursor: grab; user-select: none;
      }
      .panel-head:active { cursor: grabbing; }
      .panel-head .logo {
        width: 26px; height: 26px; border-radius: 7px; background: rgba(255,255,255,.2);
        display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      }
      .panel-head .logo svg { width: 16px; height: 16px; }
      .panel-head .name { font-size: 15px; font-weight: 700; flex: 1; }
      .icon-btn {
        width: 26px; height: 26px; border: none; border-radius: 6px; cursor: pointer;
        background: rgba(255,255,255,.18); color: #fff; font-size: 16px; line-height: 1;
        display: flex; align-items: center; justify-content: center;
      }
      .icon-btn:hover { background: rgba(255,255,255,.32); }
      .panel-body { padding: 14px; }
      .p-title {
        font-size: 13px; font-weight: 500; color: #333; margin-bottom: 6px;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      }
      .p-price { font-size: 15px; font-weight: 700; color: #f1582c; margin-bottom: 10px; }
      .p-price .orig { color: #999; text-decoration: line-through; font-size: 12px; font-weight: 400; margin-left: 6px; }
      .p-imgs-label { font-size: 11px; color: #888; margin-bottom: 5px; }
      .p-imgs { display: flex; gap: 5px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 12px; }
      .p-imgs::-webkit-scrollbar { height: 5px; }
      .p-imgs::-webkit-scrollbar-thumb { background: #ccc; border-radius: 3px; }
      .p-imgs img { width: 38px; height: 38px; min-width: 38px; object-fit: cover; border-radius: 5px; border: 1px solid #e5e5e5; }
      .p-imgs.hidden { display: none; }
      .p-imgs-label.hidden { display: none; }
      .copy-btn {
        width: 100%; padding: 11px; border: none; border-radius: 9px; cursor: pointer;
        font-size: 14px; font-weight: 600; color: #fff;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); transition: opacity .15s;
      }
      .copy-btn:hover { opacity: .92; }
      .copy-btn:disabled { opacity: .55; cursor: not-allowed; }
      .status { margin-top: 10px; padding: 8px 10px; border-radius: 7px; font-size: 12.5px; text-align: center; display: none; }
      .status.show { display: block; }
      .status.loading { background: #d1ecf1; color: #0c5460; }
      .status.success { background: #d4edda; color: #155724; }
      .status.error { background: #f8d7da; color: #721c24; }
    `;
    root.appendChild(style);

    const cartSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <div class="logo">${cartSvg}</div>
          <div class="name">Copee</div>
          <button class="icon-btn min" title="Thu gọn">–</button>
        </div>
        <div class="panel-body">
          <div class="p-title">Đang quét sản phẩm…</div>
          <div class="p-price"></div>
          <div class="p-imgs-label hidden"></div>
          <div class="p-imgs hidden"></div>
          <button class="copy-btn">Copy to Copee</button>
          <div class="status"></div>
        </div>
      </div>
      <button class="fab hidden" title="Copy to Copee">${cartSvg}</button>
    `;
    root.appendChild(wrap);

    __fabEls = {
      wrap,
      panel: wrap.querySelector('.panel'),
      fab: wrap.querySelector('.fab'),
      title: wrap.querySelector('.p-title'),
      price: wrap.querySelector('.p-price'),
      imgsLabel: wrap.querySelector('.p-imgs-label'),
      imgs: wrap.querySelector('.p-imgs'),
      copyBtn: wrap.querySelector('.copy-btn'),
      status: wrap.querySelector('.status'),
      minimizeBtn: wrap.querySelector('.min'),
    };

    __fabEls.copyBtn.addEventListener('click', doCopyFromFab);
    __fabEls.minimizeBtn.addEventListener('click', () => { if (!__fabDragged) setFabMinimized(true); });
    __fabEls.fab.addEventListener('click', () => { if (!__fabDragged) setFabMinimized(false); });

    // Kéo-thả để đổi vị trí: cầm ở thanh tiêu đề (bảng) hoặc chính nút tròn
    enableDrag(wrap.querySelector('.panel-head'));
    enableDrag(__fabEls.fab);

    if (__fabPos) applyFabPosition(__fabPos);
    setFabMinimized(__fabMinimized);
    updateFabInfo();
  }

  // Áp vị trí tuỳ chỉnh, NEO theo GÓC GẦN NHẤT (trái/phải + trên/dưới).
  // Mỗi lúc chỉ 1 phần tử hiển thị (bảng HOẶC nút), nên ghim đúng góc thì
  // thu gọn/mở rộng đều dính vào góc đó — hoạt động ở cả 4 góc màn hình.
  // pos = { anchorX: 'left'|'right', x, anchorY: 'top'|'bottom', y }
  function applyFabPosition(pos) {
    if (!__fabEls || !pos) return;
    const w = __fabEls.wrap;
    const ax = pos.anchorX === 'left' ? 'left' : 'right';
    const ay = pos.anchorY === 'top' ? 'top' : 'bottom';
    w.style.left = 'auto'; w.style.right = 'auto';
    w.style.top = 'auto'; w.style.bottom = 'auto';
    w.style[ax] = Math.max(0, pos.x) + 'px';
    w.style[ay] = Math.max(0, pos.y) + 'px';
    // Giữ trong màn hình (phòng khi cửa sổ nhỏ lại)
    const rect = w.getBoundingClientRect();
    w.style[ax] = Math.max(0, Math.min(window.innerWidth - rect.width, pos.x)) + 'px';
    w.style[ay] = Math.max(0, Math.min(window.innerHeight - rect.height, pos.y)) + 'px';
  }

  // Bật kéo-thả cho một phần tử "tay cầm"; di chuyển cả .wrap
  function enableDrag(handle) {
    if (!handle) return;
    let startX = 0, startY = 0, baseLeft = 0, baseTop = 0, dragging = false;

    const onDown = (e) => {
      // Bỏ qua khi bấm vào nút bên trong thanh tiêu đề (thu gọn…)
      if (e.target.closest('.icon-btn') && handle.classList.contains('panel-head')) return;
      const w = __fabEls.wrap;
      const rect = w.getBoundingClientRect();
      baseLeft = rect.left; baseTop = rect.top;
      startX = e.clientX; startY = e.clientY;
      dragging = true; __fabDragged = false;
      // Trong lúc kéo dùng left/top tuyệt đối cho mượt; khi thả mới snap về góc
      w.style.right = 'auto'; w.style.bottom = 'auto';
      w.style.left = baseLeft + 'px'; w.style.top = baseTop + 'px';
      handle.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };

    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!__fabDragged && Math.abs(dx) + Math.abs(dy) > 5) __fabDragged = true;
      const w = __fabEls.wrap;
      const rect = w.getBoundingClientRect();
      const left = Math.max(0, Math.min(window.innerWidth - rect.width, baseLeft + dx));
      const top = Math.max(0, Math.min(window.innerHeight - rect.height, baseTop + dy));
      w.style.left = left + 'px';
      w.style.top = top + 'px';
    };

    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      handle.releasePointerCapture?.(e.pointerId);
      if (__fabDragged) {
        const rect = __fabEls.wrap.getBoundingClientRect();
        // Chọn góc gần nhất theo tâm phần tử -> ghim vào góc đó
        const anchorX = (rect.left + rect.width / 2 < window.innerWidth / 2) ? 'left' : 'right';
        const anchorY = (rect.top + rect.height / 2 < window.innerHeight / 2) ? 'top' : 'bottom';
        __fabPos = {
          anchorX,
          x: anchorX === 'left' ? Math.round(rect.left) : Math.round(window.innerWidth - rect.right),
          anchorY,
          y: anchorY === 'top' ? Math.round(rect.top) : Math.round(window.innerHeight - rect.bottom),
        };
        applyFabPosition(__fabPos); // chuyển sang neo theo góc (không giật vị trí)
        try { chrome.storage?.local.set({ floatButtonPos: __fabPos }); } catch (err) { /* noop */ }
      }
      // Cho phép click sau khi nhả một nhịp (tránh kích hoạt click do kéo)
      setTimeout(() => { __fabDragged = false; }, 0);
    };

    handle.style.touchAction = 'none';
    handle.addEventListener('pointerdown', onDown);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function setFabMinimized(min) {
    __fabMinimized = min;
    if (!__fabEls) return;
    __fabEls.panel.classList.toggle('hidden', min);
    __fabEls.fab.classList.toggle('hidden', !min);
    // Kích thước vừa đổi (nút 56px <-> bảng 300px): clamp lại theo phần tử đang
    // hiển thị để bảng không tràn ra ngoài màn hình khi mở lại ở sát viền/góc.
    if (__fabPos) applyFabPosition(__fabPos);
    try { chrome.storage?.local.set({ floatButtonMinimized: min }); } catch (e) { /* noop */ }
  }

  // Ẩn/hiện toàn bộ nút theo: bật/tắt trong settings + có phải trang sản phẩm
  function refreshFabVisibility() {
    const host = document.getElementById(FAB_HOST_ID);
    const show = __fabEnabled && isProductPage();
    if (show) {
      if (!host) buildFab();
      else if (__fabEls) __fabEls.wrap.style.display = 'flex';
    } else if (host && __fabEls) {
      __fabEls.wrap.style.display = 'none';
    }
  }

  function formatPriceVnd(n) {
    if (!n) return '';
    try {
      return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
    } catch (e) {
      return n + '₫';
    }
  }

  function updateFabInfo() {
    if (!__fabEls) return;
    const d = __copeeLatestData;
    if (!d || !d.title) {
      __fabEls.title.textContent = 'Đang quét sản phẩm…';
      __fabEls.price.textContent = '';
      __fabEls.imgs.classList.add('hidden');
      __fabEls.imgsLabel.classList.add('hidden');
      __fabEls.copyBtn.disabled = true;
      return;
    }
    __fabEls.title.textContent = d.title;

    // Dải ảnh sẽ được copy sang Copee (nhỏ, cuộn ngang)
    const imgs = Array.isArray(d.images) ? d.images.filter(Boolean) : [];
    if (imgs.length) {
      __fabEls.imgsLabel.textContent = `Hình sẽ copy (${imgs.length})`;
      __fabEls.imgs.innerHTML = imgs
        .map(src => `<img src="${src}" alt="" loading="lazy" onerror="this.style.display='none'">`)
        .join('');
      __fabEls.imgs.classList.remove('hidden');
      __fabEls.imgsLabel.classList.remove('hidden');
    } else {
      __fabEls.imgs.classList.add('hidden');
      __fabEls.imgsLabel.classList.add('hidden');
    }

    let priceHtml = '';
    if (d.price) {
      priceHtml = formatPriceVnd(d.price);
      if (d.originalPrice && d.originalPrice > d.price) {
        priceHtml += `<span class="orig">${formatPriceVnd(d.originalPrice)}</span>`;
      }
    } else if (d.originalPrice) {
      priceHtml = formatPriceVnd(d.originalPrice);
    }
    __fabEls.price.innerHTML = priceHtml;
    if (!__fabBusy) __fabEls.copyBtn.disabled = false;
  }

  function setFabStatus(msg, type) {
    if (!__fabEls) return;
    const s = __fabEls.status;
    if (!msg) { s.className = 'status'; s.textContent = ''; return; }
    s.className = `status show ${type || ''}`;
    s.textContent = msg;
  }

  function doCopyFromFab() {
    if (__fabBusy) return;
    const data = __copeeLatestData;
    if (!data || !data.title) {
      setFabStatus('Chưa có dữ liệu sản phẩm, đang quét lại…', 'error');
      extractionAttempts = 0;
      tryExtractWithRetry();
      return;
    }

    __fabBusy = true;
    __fabEls.copyBtn.disabled = true;
    const origText = 'Copy to Copee';
    __fabEls.copyBtn.textContent = 'Đang copy…';
    setFabStatus('Đang copy sản phẩm sang Copee…', 'loading');

    safeSendMessage({ action: 'copyProduct', data }, (response) => {
      __fabBusy = false;
      if (!__fabEls) return;
      if (response && response.success) {
        __fabEls.copyBtn.textContent = '✓ Đã copy!';
        setFabStatus('✓ Copy thành công!', 'success');
        setTimeout(() => {
          if (!__fabEls) return;
          __fabEls.copyBtn.textContent = origText;
          __fabEls.copyBtn.disabled = false;
          setFabStatus('', '');
        }, 2500);
      } else {
        const err = (response && response.error) || 'Không thể copy sản phẩm';
        __fabEls.copyBtn.textContent = origText;
        __fabEls.copyBtn.disabled = false;
        setFabStatus(err, 'error');
      }
    });
  }

  // Đọc cấu hình bật/tắt + trạng thái thu gọn, rồi dựng nút
  function initFab() {
    try {
      chrome.storage?.local.get(['floatButtonEnabled', 'floatButtonMinimized', 'floatButtonPos'], (res) => {
        __fabEnabled = res.floatButtonEnabled !== false; // mặc định bật
        __fabMinimized = res.floatButtonMinimized === true;
        const p = res.floatButtonPos;
        if (p && p.anchorX && typeof p.x === 'number') {
          __fabPos = p; // định dạng mới (neo theo góc)
        } else if (p && typeof p.right === 'number') {
          // định dạng cũ {right, bottom} -> quy về góc phải-dưới
          __fabPos = { anchorX: 'right', x: p.right, anchorY: 'bottom', y: p.bottom || 0 };
        }
        refreshFabVisibility();
      });
      // Phản ứng khi người dùng đổi cài đặt trong lúc đang mở trang
      chrome.storage?.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.floatButtonEnabled) {
          __fabEnabled = changes.floatButtonEnabled.newValue !== false;
          refreshFabVisibility();
        }
      });
    } catch (e) {
      refreshFabVisibility();
    }
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

    // Lưu lại cho nút float + cập nhật thông tin hiển thị ngay khi có
    __copeeLatestData = productData;
    updateFabInfo();

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
    document.addEventListener('DOMContentLoaded', () => { setTimeout(tryExtractWithRetry, 500); initFab(); });
  } else {
    setTimeout(tryExtractWithRetry, 500);
    initFab();
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
    // Reset dữ liệu cũ để nút float không copy nhầm sản phẩm trước đó
    __copeeLatestData = null;
    updateFabInfo();
    setFabStatus('', '');
    refreshFabVisibility();
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
