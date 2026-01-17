const { google } = require('googleapis');

// ============= 配置区 =============
const SPREADSHEET_ID = '1oPHKFBEMmybpYX3DcbVOt0kIWYXvRyXe6yVv4WlrFQ8';
const SHEET_NAMES = {
    PRODUCTS: 'Products',
    CATEGORIES: 'Categories',
    USERS: 'Users',
    ORDERS: 'Orders',
    COMMISSIONS: 'Commissions',
    LOGS: 'Logs'
};
// =================================

// 通用函数：读取Sheet数据
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
            
            // 布尔值处理
            const boolFields = ['IsMemberExclusive', 'IsHotSale', 'IsVisible', 'HasCommission'];
            boolFields.forEach(field => {
                if (obj[field] === 'TRUE') obj[field] = true;
                if (obj[field] === 'FALSE') obj[field] = false;
            });

            data.push(obj);
        }
        return data;

    } catch (error) {
        console.error(`Error reading sheet ${sheetName}:`, error.message);
        return null;
    }
}

// 写入Sheet数据
async function writeToSheet(sheetName, data) {
    const apiKey = process.env.GOOGLE_API_KEY;
    const sheets = google.sheets({ version: 'v4' });

    try {
        // 先获取最后一行
        const lastRowResponse = await sheets.spreadsheets.values.get({
            auth: apiKey,
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A:A`,
        });

        const lastRow = lastRowResponse.data.values ? lastRowResponse.data.values.length + 1 : 2;
        
        const response = await sheets.spreadsheets.values.update({
            auth: apiKey,
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A${lastRow}`,
            valueInputOption: 'RAW',
            resource: { values: [data] }
        });

        return { success: true, row: lastRow };
    } catch (error) {
        console.error(`Error writing to sheet ${sheetName}:`, error.message);
        return { success: false, error: error.message };
    }
}

// 更新Sheet单元格
async function updateSheetCell(sheetName, cell, value) {
    const apiKey = process.env.GOOGLE_API_KEY;
    const sheets = google.sheets({ version: 'v4' });

    try {
        const response = await sheets.spreadsheets.values.update({
            auth: apiKey,
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!${cell}`,
            valueInputOption: 'RAW',
            resource: { values: [[value]] }
        });

        return { success: true };
    } catch (error) {
        console.error(`Error updating sheet ${sheetName}:`, error.message);
        return { success: false, error: error.message };
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
    const params = event.queryStringParameters || {};
    const action = body.action || params.action;

    let responseData = { success: false, message: 'Invalid action' };

    try {
        switch (action) {
            // 1. 获取可见产品列表
            case 'getProducts':
                const products = await fetchSheetData(SHEET_NAMES.PRODUCTS);
                if (products) {
                    // 过滤只显示 IsVisible = TRUE 的产品
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

            // 3. 获取单个产品
            case 'getProduct':
                const allProducts = await fetchSheetData(SHEET_NAMES.PRODUCTS);
                const productId = body.id || params.id;
                if (allProducts && productId) {
                    const product = allProducts.find(p => p.ID == productId && p.IsVisible !== false);
                    responseData = product ? { success: true, data: product } : { success: false, message: 'Product not found' };
                }
                break;

            // 4. 验证用户登录
            case 'verifyLogin':
                const whatsapp = body.whatsapp || params.whatsapp;
                const password = body.password || params.password;
                
                if (!whatsapp || !password) {
                    responseData = { success: false, message: 'Missing WhatsApp or password' };
                    break;
                }

                const users = await fetchSheetData(SHEET_NAMES.USERS);
                if (users) {
                    const user = users.find(u => u.Phone == whatsapp);
                    
                    if (!user) {
                        responseData = { success: false, message: 'User not found' };
                    } else if (!user.Password || user.Password !== password) {
                        responseData = { success: false, message: 'Incorrect password or no commission yet' };
                    } else if (user.HasCommission !== true) {
                        responseData = { success: false, message: 'No commission available' };
                    } else {
                        // 登录成功，返回用户信息和佣金数据
                        const commissions = await fetchSheetData(SHEET_NAMES.COMMISSIONS);
                        const userCommissions = commissions ? commissions.filter(c => c.UserID == user.ID) : [];
                        
                        responseData = {
                            success: true,
                            user: {
                                id: user.ID,
                                name: user.Name,
                                phone: user.Phone,
                                hasCommission: user.HasCommission
                            },
                            commissions: userCommissions
                        };
                    }
                } else {
                    responseData = { success: false, message: 'Failed to load users' };
                }
                break;

            // 5. 创建或获取用户
            case 'getOrCreateUser':
                const userWhatsapp = body.whatsapp || params.whatsapp;
                if (!userWhatsapp) {
                    responseData = { success: false, message: 'Missing WhatsApp number' };
                    break;
                }

                const allUsers = await fetchSheetData(SHEET_NAMES.USERS);
                let user = allUsers ? allUsers.find(u => u.Phone == userWhatsapp) : null;

                if (!user) {
                    // 创建新用户
                    const newUser = [
                        (allUsers ? allUsers.length + 1 : 1), // ID
                        userWhatsapp, // Phone
                        '', // Name
                        `REF${Date.now()}`, // ReferralCode
                        '', // Referrer
                        0, // TotalCommission
                        0, // PendingCommission
                        0, // PaidCommission
                        0, // ReferralCount
                        'user', // Role
                        `TOKEN${Date.now()}`, // Token
                        new Date().toISOString(), // CreatedAt
                        '', // Password (空，等待后台人工填写)
                        false, // HasCommission
                        '' // CommissionPasswordSent
                    ];

                    const writeResult = await writeToSheet(SHEET_NAMES.USERS, newUser);
                    if (writeResult.success) {
                        user = {
                            ID: newUser[0],
                            Phone: userWhatsapp,
                            Name: '',
                            HasCommission: false
                        };
                        responseData = { success: true, user: user, isNew: true };
                    } else {
                        responseData = { success: false, message: 'Failed to create user' };
                    }
                } else {
                    responseData = { success: true, user: user, isNew: false };
                }
                break;

            // 6. 获取用户佣金数据
            case 'getUserCommissions':
                const userId = body.userId || params.userId;
                const whatsappNum = body.whatsapp || params.whatsapp;
                
                if (!userId && !whatsappNum) {
                    responseData = { success: false, message: 'Missing user identifier' };
                    break;
                }

                const allCommissions = await fetchSheetData(SHEET_NAMES.COMMISSIONS);
                const allUsersForCommission = await fetchSheetData(SHEET_NAMES.USERS);
                
                let targetUserId = userId;
                if (!targetUserId && whatsappNum) {
                    const targetUser = allUsersForCommission.find(u => u.Phone == whatsappNum);
                    targetUserId = targetUser ? targetUser.ID : null;
                }

                if (allCommissions && targetUserId) {
                    const userCommissions = allCommissions.filter(c => c.UserID == targetUserId);
                    
                    // 计算统计
                    const totalCommission = userCommissions.reduce((sum, c) => sum + (c.Commission || 0), 0);
                    const pendingCommission = userCommissions
                        .filter(c => c.Status === 'pending')
                        .reduce((sum, c) => sum + (c.Commission || 0), 0);
                    const paidCommission = userCommissions
                        .filter(c => c.Status === 'paid')
                        .reduce((sum, c) => sum + (c.Commission || 0), 0);

                    responseData = {
                        success: true,
                        commissions: userCommissions,
                        totalCommission: totalCommission,
                        pendingCommission: pendingCommission,
                        paidCommission: paidCommission,
                        referralCount: userCommissions.length
                    };
                } else {
                    responseData = { success: false, message: 'No commissions found' };
                }
                break;

            // 7. 记录日志
            case 'logActivity':
                const { type, message, deviceId, whatsapp: logWhatsapp } = body;
                const logEntry = [
                    new Date().toISOString(), // Timestamp
                    type || 'info', // Type
                    message || '', // Message
                    deviceId || '', // DeviceID
                    logWhatsapp || '', // WhatsApp
                    JSON.stringify(body.data || {}) // Data
                ];

                const logResult = await writeToSheet(SHEET_NAMES.LOGS, logEntry);
                responseData = logResult.success ? 
                    { success: true } : 
                    { success: false, message: 'Failed to log activity' };
                break;

            // 8. 获取管理员数据
            case 'getAdminStats':
                const [adminProducts, adminUsers, adminOrders, adminCommissions] = await Promise.all([
                    fetchSheetData(SHEET_NAMES.PRODUCTS),
                    fetchSheetData(SHEET_NAMES.USERS),
                    fetchSheetData(SHEET_NAMES.ORDERS),
                    fetchSheetData(SHEET_NAMES.COMMISSIONS)
                ]);

                const totalSales = adminOrders ? adminOrders.reduce((sum, o) => sum + (o.Amount || 0), 0) : 0;
                const totalCommission = adminCommissions ? adminCommissions.reduce((sum, c) => sum + (c.Commission || 0), 0) : 0;
                const userCount = adminUsers ? adminUsers.length : 0;
                const orderCount = adminOrders ? adminOrders.length : 0;

                responseData = {
                    success: true,
                    totalSales: totalSales,
                    totalCommission: totalCommission,
                    userCount: userCount,
                    orderCount: orderCount,
                    commissions: adminCommissions || []
                };
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
