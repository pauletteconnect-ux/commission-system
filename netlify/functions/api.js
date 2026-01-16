const { google } = require('googleapis');

// ============= 配置区（请修改）=============
const SPREADSHEET_ID = '1oPHKFBEMmybpYX3DcbVOt0kIWYXvRyXe6yVv4WlrFQ8'; // 替换成你真实的 Sheet ID
const SHEET_NAMES = {
    PRODUCTS: 'Products',   // 产品表名
    CATEGORIES: 'Categories' // 分类表名
};
// ==========================================

// 通用函数：读取 Sheet 并转成 JSON
async function fetchSheetData(sheetName) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('Missing GOOGLE_API_KEY');

    const sheets = google.sheets({ version: 'v4' });
    const range = `${sheetName}!A:Z`; // 读取 A 到 Z 列，不够可以改 A:AZ

    try {
        const response = await sheets.spreadsheets.values.get({
            auth: apiKey,
            spreadsheetId: SPREADSHEET_ID,
            range: range,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) return [];

        const headers = rows[0];
        const data = [];

        // 从第 2 行开始遍历（跳过表头）
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0 || row.every(cell => cell === '')) continue;

            let obj = {};
            headers.forEach((header, index) => {
                if (header) obj[header] = row[index] || '';
            });

            // 类型转换（防止数字变成字符串导致前端计算错误）
            if(obj.ID) obj.ID = Number(obj.ID);
            if(obj.OriginalPrice) obj.OriginalPrice = Number(obj.OriginalPrice);
            if(obj.MemberPrice) obj.MemberPrice = Number(obj.MemberPrice);
            if(obj.Commission) obj.Commission = Number(obj.Commission);
            if(obj.StockCount) obj.StockCount = Number(obj.StockCount);
            if(obj.PurchasedCount) obj.PurchasedCount = Number(obj.PurchasedCount);
            
            // 布尔值处理
            if(obj.IsMemberExclusive === 'TRUE') obj.IsMemberExclusive = true;
            if(obj.IsMemberExclusive === 'FALSE') obj.IsMemberExclusive = false;
            if(obj.IsHotSale === 'TRUE') obj.IsHotSale = true;
            if(obj.IsHotSale === 'FALSE') obj.IsHotSale = false;

            data.push(obj);
        }
        return data;

    } catch (error) {
        console.error(`Error reading sheet ${sheetName}:`, error.message);
        return null;
    }
}

// Netlify Function 主入口
exports.handler = async (event) => {
    // CORS 设置（必须保留，否则前端报错）
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    };
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

    const body = JSON.parse(event.body || '{}');
    const action = body.action || (event.queryStringParameters ? event.queryStringParameters.action : null);

    let responseData = { success: false, message: 'Invalid action' };

    try {
        switch (action) {
            // 1. 获取产品列表（核心：现在读 Google Sheet）
            case 'getProducts':
                const products = await fetchSheetData(SHEET_NAMES.PRODUCTS);
                responseData = products ? 
                    { success: true, data: products } : 
                    { success: false, message: 'Failed to load products' };
                break;

            // 2. 获取分类列表（核心：现在读 Google Sheet）
            case 'getCategories':
                const categories = await fetchSheetData(SHEET_NAMES.CATEGORIES);
                responseData = categories ? 
                    { success: true, data: categories } : 
                    { success: false, message: 'Failed to load categories' };
                break;

            // 3. 获取单个产品详情（保留）
            case 'getProduct':
                const allProducts = await fetchSheetData(SHEET_NAMES.PRODUCTS);
                const productId = body.id || (event.queryStringParameters ? event.queryStringParameters.id : null);
                if (allProducts && productId) {
                    const product = allProducts.find(p => p.ID == productId);
                    responseData = product ? { success: true, data: product } : { success: false, message: 'Product not found' };
                }
                break;

            // 4. 创建匿名用户（保留原有逻辑）
            case 'createAnonymousUser':
                const userId = 'guest_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                responseData = { 
                    success: true, 
                    user: { id: userId, role: 'guest', token: 'dummy_token_for_guest' } 
                };
                break;

            // 5. 记录产品浏览（保留接口，实际写入逻辑需在 Sheet 端实现，这里先返回成功）
            case 'recordProductView':
                // 注意：这里如果要真的写入 Google Sheet 比较复杂（需要 OAuth），
                // 目前先返回成功，保证前端不报错。
                console.log(`View logged: User ${body.userId}, Product ${body.productId}`);
                responseData = { success: true };
                break;

            default:
                responseData = { success: false, message: 'Unknown action: ' + action };
        }
    } catch (error) {
        console.error('Handler Error:', error);
        responseData = { success: false, message: 'Server error', error: error.message };
    }

    return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(responseData)
    };
};
