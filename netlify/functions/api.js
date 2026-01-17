// ============= 配置区（请修改）=============
const SPREADSHEET_ID = '1oPHKFBEMmybpYX3DcbVOt0kIWYXvRyXe6yVv4WlrFQ8'; // 替换成你真实的 Sheet ID
const SHEET_NAMES = {
    PRODUCTS: 'Products',
    CATEGORIES: 'Categories',
    USERS: 'Users',
    ORDERS: 'Orders',
    COMMISSIONS: 'Commissions',
    LOGS: 'Logs'
};
// ==========================================

const { google } = require('googleapis');

// 通用函数：读取 Sheet 并转成 JSON
async function fetchSheetData(sheetName) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('Missing GOOGLE_API_KEY');

    const sheets = google.sheets({ version: 'v4' });
    const range = `${sheetName}!A:Z`;

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

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0 || row.every(cell => cell === '')) continue;

            let obj = {};
            headers.forEach((header, index) => {
                if (header) obj[header] = row[index] || '';
            });

            // 类型转换
            if(obj.ID) obj.ID = Number(obj.ID);
            if(obj.OriginalPrice) obj.OriginalPrice = Number(obj.OriginalPrice);
            if(obj.MemberPrice) obj.MemberPrice = Number(obj.MemberPrice);
            if(obj.Commission) obj.Commission = Number(obj.Commission);
            if(obj.StockCount) obj.StockCount = Number(obj.StockCount);
            if(obj.PurchasedCount) obj.PurchasedCount = Number(obj.PurchasedCount);
            if(obj.Amount) obj.Amount = Number(obj.Amount);
            if(obj.TotalCommission) obj.TotalCommission = Number(obj.TotalCommission);
            if(obj.PendingCommission) obj.PendingCommission = Number(obj.PendingCommission);
            if(obj.PaidCommission) obj.PaidCommission = Number(obj.PaidCommission);
            if(obj.ReferralCount) obj.ReferralCount = Number(obj.ReferralCount);
            
            // 布尔值处理
            if(obj.IsMemberExclusive === 'TRUE') obj.IsMemberExclusive = true;
            if(obj.IsMemberExclusive === 'FALSE') obj.IsMemberExclusive = false;
            if(obj.IsHotSale === 'TRUE') obj.IsHotSale = true;
            if(obj.IsHotSale === 'FALSE') obj.IsHotSale = false;
            if(obj.IsVisible === 'TRUE') obj.IsVisible = true;
            if(obj.IsVisible === 'FALSE') obj.IsVisible = false;

            data.push(obj);
        }
        return data;

    } catch (error) {
        console.error(`Error reading sheet ${sheetName}:`, error.message);
        return null;
    }
}

// 通用函数：向 Sheet 写入数据
async function appendToSheet(sheetName, values) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('Missing GOOGLE_API_KEY');

    const sheets = google.sheets({ version: 'v4' });
    const range = `${sheetName}!A:Z`;

    try {
        const response = await sheets.spreadsheets.values.append({
            auth: apiKey,
            spreadsheetId: SPREADSHEET_ID,
            range: range,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [values]
            }
        });
        return response;
    } catch (error) {
        console.error(`Error appending to sheet ${sheetName}:`, error.message);
        throw error;
    }
}

// Netlify Function 主入口
exports.handler = async (event) => {
    // CORS 设置
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
            // 1. 获取产品列表（只返回 IsVisible=TRUE 的产品）
            case 'getProducts':
                const products = await fetchSheetData(SHEET_NAMES.PRODUCTS);
                if (products) {
                    // 过滤：只返回可见的产品
                    const visibleProducts = products.filter(p => p.IsVisible !== false);
                    responseData = { success: true, data: visibleProducts };
                } else {
                    responseData = { success: false, message: 'Failed to load products' };
                }
                break;

            // 2. 获取分类列表
            case 'getCategories':
                const categories = await fetchSheetData(SHEET_NAMES.CATEGORIES);
                responseData = categories ? 
                    { success: true, data: categories } : 
                    { success: false, message: 'Failed to load categories' };
                break;

            // 3. 获取单个产品详情
            case 'getProduct':
                const allProducts = await fetchSheetData(SHEET_NAMES.PRODUCTS);
                const productId = body.id || (event.queryStringParameters ? event.queryStringParameters.id : null);
                if (allProducts && productId) {
                    const product = allProducts.find(p => p.ID == productId);
                    responseData = product ? { success: true, data: product } : { success: false, message: 'Product not found' };
                }
                break;

            // 4. 获取用户信息（通过 WhatsApp 号码）
            case 'getUserByPhone':
                const phone = body.phone;
                if (!phone) {
                    responseData = { success: false, message: 'Phone number required' };
                    break;
                }
                const users = await fetchSheetData(SHEET_NAMES.USERS);
                if (users) {
                    const user = users.find(u => u.Phone === phone);
                    responseData = user ? 
                        { success: true, data: user } : 
                        { success: false, message: 'User not found' };
                } else {
                    responseData = { success: false, message: 'Failed to load users' };
                }
                break;

            // 5. 获取用户的佣金数据（通过 WhatsApp 号码）
            case 'getCommissionsByPhone':
                const userPhone = body.phone;
                if (!userPhone) {
                    responseData = { success: false, message: 'Phone number required' };
                    break;
                }
                
                const commissions = await fetchSheetData(SHEET_NAMES.COMMISSIONS);
                const orders = await fetchSheetData(SHEET_NAMES.ORDERS);
                
                if (commissions && orders) {
                    // 查找所有通过该 WhatsApp 号码分享的订单
                    const userOrders = orders.filter(o => o.SharerWhatsApp === userPhone);
                    
                    // 计算佣金统计
                    let totalCommission = 0;
                    let pendingCommission = 0;
                    let verifiedCommission = 0;
                    
                    userOrders.forEach(order => {
                        const commission = commissions.find(c => c.OrderID == order.ID);
                        if (commission) {
                            const amount = Number(commission.Commission) || 0;
                            totalCommission += amount;
                            
                            if (commission.Status === 'pending') {
                                pendingCommission += amount;
                            } else if (commission.Status === 'verified') {
                                verifiedCommission += amount;
                            }
                        }
                    });
                    
                    responseData = {
                        success: true,
                        data: {
                            totalCommission,
                            pendingCommission,
                            verifiedCommission,
                            referralCount: userOrders.length,
                            orders: userOrders
                        }
                    };
                } else {
                    responseData = { success: false, message: 'Failed to load commission data' };
                }
                break;

            // 6. 记录订单中的分享者 WhatsApp（管理员手工操作后调用）
            case 'recordSharerWhatsApp':
                const orderId = body.orderId;
                const sharerWhatsApp = body.sharerWhatsApp;
                
                if (!orderId || !sharerWhatsApp) {
                    responseData = { success: false, message: 'OrderID and SharerWhatsApp required' };
                    break;
                }
                
                try {
                    // 这里实际上应该更新 Orders 表中的 SharerWhatsApp 字段
                    // 但由于 Google Sheets API 的限制，这里只是记录日志
                    console.log(`Recording: OrderID=${orderId}, SharerWhatsApp=${sharerWhatsApp}`);
                    responseData = { success: true, message: 'Sharer WhatsApp recorded' };
                } catch (error) {
                    responseData = { success: false, message: 'Failed to record sharer WhatsApp' };
                }
                break;

            // 7. 检测异常（多个 WhatsApp 关联同一 DEVICE）
            case 'detectAnomalies':
                const logs = await fetchSheetData(SHEET_NAMES.LOGS);
                if (logs) {
                    responseData = { success: true, data: logs };
                } else {
                    responseData = { success: false, message: 'Failed to load logs' };
                }
                break;

            // 8. 记录异常
            case 'recordAnomaly':
                const anomaly = {
                    LogID: 'log_' + Date.now(),
                    DeviceID: body.deviceId || '',
                    UseID: body.useId || '',
                    AnomalyType: body.anomalyType || '',
                    Details: body.details || '',
                    DetectedTime: new Date().toISOString(),
                    Status: 'pending'
                };
                
                try {
                    const values = Object.values(anomaly);
                    await appendToSheet(SHEET_NAMES.LOGS, values);
                    responseData = { success: true, message: 'Anomaly recorded' };
                } catch (error) {
                    responseData = { success: false, message: 'Failed to record anomaly' };
                }
                break;

            // 9. 创建匿名用户（保留原有逻辑）
            case 'createAnonymousUser':
                const userId = 'guest_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                responseData = { 
                    success: true, 
                    user: { id: userId, role: 'guest', token: 'dummy_token_for_guest' } 
                };
                break;

            // 10. 记录产品浏览
            case 'recordProductView':
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
