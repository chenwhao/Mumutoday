// 导入需要的库
const express = require('express');
const mysql = require('mysql2/promise'); // 使用 promise 版本的 mysql2
const cors = require('cors');

// ... 新增 require 语句 ...
const multer = require('multer'); // ▼▼▼ 添加 multer
const Papa = require('papaparse');  // ▼▼▼ 添加 papaparse
const fs = require('fs');         // ▼▼▼ 添加 fs (Node.js 内置，用于文件系统操作，备用)
const path = require('path');       // ▼▼▼ 添加 path (Node.js 内置，用于处理路径)

// 配置 Multer：这里我们使用 memoryStorage 将文件暂存到内存中
// 对于非常大的文件，可能需要用 diskStorage 存到临时文件
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const port = 3000; 

// ▼▼▼ 添加下面这行 ▼▼▼
app.use(express.json()); // 让 Express 能够解析请求体中的 JSON 数据
// ▲▲▲ 添加上面这行 ▲▲▲

app.use(cors()); 
// ... (数据库配置 dbConfig 和 pool)


// 使用 CORS 中间件，允许所有来源的请求 (开发阶段可以，生产环境需要更严格配置)
app.use(cors());

// MySQL 数据库连接配置 (!!! 请务必替换成你自己的数据库信息 !!!)
const dbConfig = {
    host: '1Panel-mysql-aJHM', // 数据库地址，通常是本机
    user: 'spelling_user', // 替换成你在步骤 3 创建的数据库用户名
    password: '1234567Cwh', // 替换成你在步骤 3 创建的数据库密码
    database: 'spelling_game' // 替换成你在步骤 3 创建的数据库名
};

// 创建数据库连接池 (更高效地处理数据库连接)
let pool;
try {
    pool = mysql.createPool(dbConfig);
    console.log('数据库连接池配置完成'); 
} catch (error) {
    console.error('创建数据库连接池失败:', error);
    process.exit(1); // 配置失败，直接退出程序
}

// 定义一个简单的测试 API 路由
app.get('/api/test', async (req, res) => {
    let connection; // 将 connection 定义在 try 外部，以便 finally 中可以访问
    try {
        // 尝试从连接池获取一个连接
        console.log('尝试获取数据库连接...');
        connection = await pool.getConnection();
        console.log('成功获取数据库连接！');

        // 执行一个简单的 SQL 查询 (测试数据库是否工作)
        const [rows, fields] = await connection.query('SELECT 1 + 1 AS solution');
        console.log('数据库查询完成');

        // 返回成功信息和查询结果
        res.json({ 
            message: '后端服务运行中，数据库连接成功！',
            db_result: rows[0].solution 
        });
    } catch (error) {
        // 如果出错，打印错误信息到服务器控制台
        console.error('数据库连接或查询出错:', error);
        // 返回错误信息给客户端
        res.status(500).json({ message: '服务器内部错误，无法连接数据库或执行查询' });
    } finally {
        if (connection) {
            connection.release(); // 无论成功或失败，最后都释放连接回连接池
            console.log('数据库连接已释放');
        }
    }
});

// POST /api/words - 添加一个新单词 (支持 week_tag)
app.post('/api/words', async (req, res) => {
    // ▼▼▼ 修改点1：从 req.body 中解构出 week_tag ▼▼▼
    const { english_word, chinese_definition, example_sentence_en, example_sentence_cn, week_tag } = req.body;

    if (!english_word || !chinese_definition) {
        return res.status(400).json({ message: '英文单词和中文释义不能为空' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        console.log('获取连接成功 - 准备添加单词');

        // ▼▼▼ 修改点2：SQL 语句中加入 week_tag 列和对应的占位符 ▼▼▼
        const sql = `
            INSERT INTO words 
            (english_word, chinese_definition, example_sentence_en, example_sentence_cn, week_tag) 
            VALUES (?, ?, ?, ?, ?); 
        `; 
        // ▼▼▼ 修改点3：values 数组中加入 week_tag 的值 ▼▼▼
        const values = [
            english_word, 
            chinese_definition, 
            example_sentence_en || null, 
            example_sentence_cn || null,
            week_tag || null // 如果 week_tag 未提供，则插入 NULL
        ];

        const [result] = await connection.query(sql, values);
        console.log('单词添加成功，ID:', result.insertId, 'Week Tag:', week_tag); // 可以在日志中也打印 week_tag

        res.status(201).json({ 
            message: '单词添加成功', 
            word_id: result.insertId 
        });

    } catch (error) {
        console.error('添加单词时出错:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: '错误：该英文单词已存在' });
        }
        res.status(500).json({ message: '服务器内部错误，无法添加单词' });
    } finally {
        if (connection) {
            connection.release();
            console.log('连接已释放 - 添加单词操作结束');
        }
    }
});

// GET /api/words - 获取所有单词列表 (含掌握状态、当前选中状态，并支持按 week_tag 筛选)
app.get('/api/words', async (req, res) => {
    const userId = 1; // 固定用户 ID
    const requestedTag = req.query.tag || null; // ▼▼▼ 获取 tag 查询参数 ▼▼▼
    let connection;

    console.log(`请求单词列表, UserID: ${userId}, Requested Tag: ${requestedTag || 'N/A'}`);

    try {
        connection = await pool.getConnection();

        // 1. 获取当前用户的选中列表 (这部分逻辑不变)
        const [sessionRows] = await connection.query(
            'SELECT selected_word_ids FROM current_practice_session WHERE user_id = ?', [userId]
        );
        let selectedIdSet = new Set();
        if (sessionRows.length > 0 && sessionRows[0].selected_word_ids) {
            try {
                const selectedIds = JSON.parse(sessionRows[0].selected_word_ids);
                if (Array.isArray(selectedIds)) selectedIdSet = new Set(selectedIds.map(id => Number(id)));
            } catch (parseError) { console.error("解析 'selected_word_ids' JSON 失败:", parseError); }
        }

        // 2. 构建获取单词的 SQL 语句
        let sqlWords = `
            SELECT 
                w.word_id, 
                w.english_word, 
                w.chinese_definition, 
                w.added_timestamp,
                w.week_tag,  -- ▼▼▼ 添加 week_tag 字段到 SELECT 列表 ▼▼▼
                COALESCE(up.is_mastered, 0) as is_mastered 
            FROM words w 
            LEFT JOIN user_progress up ON w.word_id = up.word_id AND up.user_id = ? 
        `;
        const queryParams = [userId]; // 初始化查询参数数组

        if (requestedTag) { // 如果请求中带有 tag 参数
            sqlWords += ' WHERE w.week_tag = ? '; // 添加 WHERE 条件
            queryParams.push(requestedTag);        // 将 tag 值加入查询参数
        }

        sqlWords += ' ORDER BY w.added_timestamp DESC;'; // 排序

        console.log("Executing SQL for words:", sqlWords.trim().replace(/\s+/g, ' '), "with params:", queryParams);
        const [wordRows] = await connection.query(sqlWords, queryParams); 
        console.log(`成功获取单词列表，数量: ${wordRows.length}`);

        // 3. 为每个单词添加 is_selected 标记 (这部分逻辑不变)
        const wordsWithSelectionAndStatus = wordRows.map(word => ({
            ...word,
            is_selected: selectedIdSet.has(word.word_id)
        }));

        res.status(200).json(wordsWithSelectionAndStatus); 

    } catch (error) {
        console.error('获取单词列表时出错:', error);
        res.status(500).json({ message: '服务器内部错误，无法获取单词列表' });
    } finally {
        if (connection) {
             console.log('连接已释放 - 获取单词列表操作结束 (旧)'); // 标记一下以便确认替换
             connection.release();
        }
    }
});

// GET /api/quiz/next - 获取下一个练习单词 (支持 session 模式及自动过渡)
app.get('/api/quiz/next', async (req, res) => {
    const mode = req.query.mode || 'new'; // 默认 'new'
    const userId = 1; // 固定用户 ID
    const sessionIdsParam = req.query.ids; // 获取 'ids=5,12,18' 这样的字符串

    let connection;
    let sql = '';
    let queryParams = [userId]; // SQL 查询参数，默认包含 userId

    console.log(`请求下一个单词，模式: ${mode}, 用户ID: ${userId}, Session IDs: ${sessionIdsParam || 'N/A'}`);

    try {
        connection = await pool.getConnection();
        console.log('获取连接成功 - 准备根据模式获取下一个单词');

        // --- 处理 Session 模式 ---
        if (mode === 'session' && sessionIdsParam) {
            const sessionIds = sessionIdsParam.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id)); // 解析 ID 列表

            if (sessionIds.length > 0) {
                console.log('处理 Session 模式，IDs:', sessionIds);
                // 1. 检查 Session 列表内是否还有未掌握的单词
                const checkSessionSql = `
                    SELECT COUNT(w.word_id) as unmastered_in_session 
                    FROM words w
                    LEFT JOIN user_progress up ON w.word_id = up.word_id AND up.user_id = ?
                    WHERE w.word_id IN (?) AND (up.progress_id IS NULL OR up.is_mastered = 0);
                `;
                const [checkResult] = await connection.query(checkSessionSql, [userId, sessionIds]);
                const unmasteredInSession = checkResult[0].unmastered_in_session;
                console.log(`Session 内未掌握单词数: ${unmasteredInSession}`);

                if (unmasteredInSession > 0) {
                    // 1.a 如果 Session 内还有未掌握的，优先从 Session 内未掌握的随机取一个
                    console.log('从 Session 内未掌握的单词中随机选取...');
                    sql = `
                        SELECT w.word_id, w.english_word, w.chinese_definition
                        FROM words w
                        LEFT JOIN user_progress up ON w.word_id = up.word_id AND up.user_id = ?
                        WHERE w.word_id IN (?) AND (up.progress_id IS NULL OR up.is_mastered = 0)
                        ORDER BY RAND() 
                        LIMIT 1;
                    `;
                    queryParams = [userId, sessionIds]; // 查询参数包含 userId 和 sessionIds 数组
                } else {
                    // 1.b 如果 Session 内单词已全部掌握，则自动过渡到查找库中其他未掌握的单词
                    console.log('Session 内单词已全部掌握，自动过渡到查找库中其他未掌握单词...');
                    sql = `
                        SELECT w.word_id, w.english_word, w.chinese_definition
                        FROM words w
                        LEFT JOIN user_progress up ON w.word_id = up.word_id AND up.user_id = ?
                        WHERE up.progress_id IS NULL OR up.is_mastered = 0 
                        -- 这里不需要再加 w.word_id NOT IN (?) 因为 is_mastered=0 已经排除了 session 中已掌握的词
                        ORDER BY RAND() 
                        LIMIT 1;
                    `;
                    queryParams = [userId]; // 查询参数只有 userId
                }
            } else {
                // 如果提供了 mode=session 但 ids 参数无效或为空，按 'new' 模式处理
                console.log("Session IDs 无效或为空，按 'new' 模式处理");
                 sql = `
                    SELECT w.word_id, w.english_word, w.chinese_definition
                    FROM words w
                    LEFT JOIN user_progress up ON w.word_id = up.word_id AND up.user_id = ?
                    WHERE up.progress_id IS NULL OR up.is_mastered = 0
                    ORDER BY RAND() 
                    LIMIT 1;
                `;
                 queryParams = [userId];
            }

        } 
        // --- 处理 Review 模式 ---
        else if (mode === 'review') {
             console.log('处理 Review 模式');
             sql = `
                SELECT w.word_id, w.english_word, w.chinese_definition
                FROM words w
                INNER JOIN user_progress up ON w.word_id = up.word_id
                WHERE up.user_id = ? AND up.is_mastered = 1
                ORDER BY RAND() -- 或 ORDER BY up.last_answered_timestamp ASC
                LIMIT 1;
            `;
             queryParams = [userId];
        } 
        // --- 处理 New 或其他 (默认) 模式 ---
        else { 
             console.log(`处理 New 或默认模式 (${mode})`);
             sql = `
                SELECT w.word_id, w.english_word, w.chinese_definition
                FROM words w
                LEFT JOIN user_progress up ON w.word_id = up.word_id AND up.user_id = ?
                WHERE up.progress_id IS NULL OR up.is_mastered = 0
                ORDER BY RAND() 
                LIMIT 1;
            `;
             queryParams = [userId];
        }

        // --- 执行最终确定的 SQL 查询 ---
        console.log("执行 SQL:", sql.trim().replace(/\s+/g, ' '), "参数:", queryParams);
        const [rows] = await connection.query(sql, queryParams);

        // --- 处理查询结果 ---
        if (rows.length > 0) {
            console.log(`找到下一个单词:`, rows[0]);
            res.status(200).json(rows[0]); 
        } else {
            // 所有模式都没找到合适的单词了
            console.log(`在模式 '${mode}' 下最终没有找到合适的单词`);
            res.status(404).json({ message: `太棒了！所有可练习的单词都掌握啦！` }); 
        }

    } catch (error) {
        console.error(`获取下一个单词 (模式: ${mode}) 时出错:`, error);
        res.status(500).json({ message: '服务器内部错误，无法获取下一个单词' });
    } finally {
        if (connection) {
            connection.release();
            console.log('连接已释放 - 获取下一个单词操作结束');
        }
    }
});

// POST /api/quiz/submit - 提交单词拼写答案
app.post('/api/quiz/submit', async (req, res) => {
    // 1. 从请求体获取数据
    const { word_id, user_attempt } = req.body;
    const userId = 1; // 固定用户 ID

    // 2. 简单验证
    if (!word_id || user_attempt === undefined || user_attempt === null) {
        return res.status(400).json({ message: '缺少 word_id 或 user_attempt' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        console.log(`获取连接成功 - 准备处理答案提交 (Word ID: ${word_id}, Attempt: ${user_attempt})`);

        // 3. 查询正确的单词拼写
        const [wordRows] = await connection.query('SELECT english_word FROM words WHERE word_id = ?', [word_id]);

        if (wordRows.length === 0) {
            console.log(`提交答案失败，未找到 Word ID: ${word_id}`);
            return res.status(404).json({ message: '未找到对应的单词' });
        }
        const correctSpelling = wordRows[0].english_word;

        // 4. 判断答案是否正确 (忽略大小写比较)
        const isCorrect = user_attempt.trim().toLowerCase() === correctSpelling.toLowerCase();
        console.log(`用户尝试: "<span class="math-inline">\{user\_attempt\}", 正确拼写\: "</span>{correctSpelling}", 是否正确: ${isCorrect}`);

        // 5. 获取当前进度 (如果存在)
        let currentStreak = 0;
        const [progressRows] = await connection.query('SELECT correct_streak FROM user_progress WHERE user_id = ? AND word_id = ?', [userId, word_id]);
        if (progressRows.length > 0) {
            currentStreak = progressRows[0].correct_streak;
        }

        // 6. 计算新的进度
        let newStreak = 0;
        let newIsMastered = 0;
        if (isCorrect) {
            newStreak = currentStreak + 1;
            newIsMastered = (newStreak >= 3) ? 1 : 0; // 连续答对 3 次算掌握
            console.log(`回答正确! 当前连续次数: ${currentStreak}, 新连续次数: ${newStreak}, 是否掌握: ${newIsMastered}`);
        } else {
            newStreak = 0; // 答错，连续次数清零
            newIsMastered = 0; // 答错不可能标记为掌握
            console.log(`回答错误. 连续次数清零`);
        }

        // 7. 更新或插入进度到 user_progress 表
        // 使用 INSERT ... ON DUPLICATE KEY UPDATE (UPSERT) 来处理记录存在或不存在的情况
        const upsertSql = `
            INSERT INTO user_progress (user_id, word_id, correct_streak, is_mastered, last_answered_timestamp)
            VALUES (?, ?, ?, ?, NOW()) 
            ON DUPLICATE KEY UPDATE 
            correct_streak = VALUES(correct_streak), 
            is_mastered = VALUES(is_mastered),
            last_answered_timestamp = NOW(); 
        `;
        // 注意: last_answered_timestamp 在 INSERT 和 UPDATE 时都用 NOW() 更新为当前时间
        // 或者如果你在表定义中用了 ON UPDATE CURRENT_TIMESTAMP, UPDATE 时可以省略设置它

        await connection.query(upsertSql, [userId, word_id, newStreak, newIsMastered]);
        console.log(`用户进度已更新/插入 (UserID: ${userId}, WordID: ${word_id}, Streak: ${newStreak}, Mastered: ${newIsMastered})`);

        // 8. 返回结果给前端
        const responsePayload = {
            correct: isCorrect,
        };
        if (!isCorrect) {
            responsePayload.correct_spelling = correctSpelling; // 如果答错，告诉前端正确答案
        }
        res.status(200).json(responsePayload);

    } catch (error) {
        console.error(`处理答案提交时出错 (Word ID: ${word_id}):`, error);
        res.status(500).json({ message: '服务器内部错误，无法处理答案提交' });
    } finally {
        if (connection) {
            connection.release();
            console.log('连接已释放 - 答案提交操作结束');
        }
    }
});

// PUT /api/words/:id - 修改一个已存在的单词 (支持 week_tag)
app.put('/api/words/:id', async (req, res) => {
    const wordId = parseInt(req.params.id, 10); 
    // ▼▼▼ 修改点1：从 req.body 中解构出 week_tag ▼▼▼
    const { english_word, chinese_definition, example_sentence_en, example_sentence_cn, week_tag } = req.body;

    if (isNaN(wordId)) {
        return res.status(400).json({ message: '无效的单词 ID' });
    }
    if (!english_word || !chinese_definition) {
        return res.status(400).json({ message: '英文单词和中文释义不能为空' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        console.log(`获取连接成功 - 准备修改 Word ID: ${wordId}`);

        // ▼▼▼ 修改点2：SQL 语句 SET 部分增加 week_tag = ? ▼▼▼
        const sql = `
            UPDATE words 
            SET 
                english_word = ?, 
                chinese_definition = ?, 
                example_sentence_en = ?, 
                example_sentence_cn = ?,
                week_tag = ? 
            WHERE word_id = ?;
        `;
        // ▼▼▼ 修改点3：values 数组中加入 week_tag 的值 ▼▼▼
        const values = [
            english_word, 
            chinese_definition, 
            example_sentence_en || null, 
            example_sentence_cn || null, 
            week_tag || null, // 如果 week_tag 未提供，则设为 NULL
            wordId 
        ];

        const [result] = await connection.query(sql, values);

        if (result.affectedRows === 0) {
            console.log(`修改失败，未找到 Word ID: ${wordId}`);
            return res.status(404).json({ message: '未找到要修改的单词' });
        }

        console.log(`成功修改 Word ID: ${wordId}, New Week Tag: ${week_tag}`);
        res.status(200).json({ message: '单词修改成功' });

    } catch (error) {
        console.error(`修改单词时出错 (Word ID: ${wordId}):`, error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: '错误：修改后的英文单词与现有其他单词冲突' }); 
        }
        res.status(500).json({ message: '服务器内部错误，无法修改单词' });
    } finally {
        if (connection) {
            connection.release();
            console.log('连接已释放 - 修改单词操作结束');
        }
    }
});

// DELETE /api/words/:id - 删除一个单词
app.delete('/api/words/:id', async (req, res) => {
    // 1. 从 URL 参数获取要删除的单词 ID
    const wordId = parseInt(req.params.id, 10);

    // 2. 验证 ID
    if (isNaN(wordId)) {
        return res.status(400).json({ message: '无效的单词 ID' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        console.log(`获取连接成功 - 准备删除 Word ID: ${wordId}`);

        // 3. 准备 SQL 删除语句
        const sql = 'DELETE FROM words WHERE word_id = ?';

        // 4. 执行 SQL 删除
        const [result] = await connection.query(sql, [wordId]);

        // 5. 检查是否真的删除了数据
        if (result.affectedRows === 0) {
            console.log(`删除失败，未找到 Word ID: ${wordId}`);
            return res.status(404).json({ message: '未找到要删除的单词' });
        }

        console.log(`成功删除 Word ID: ${wordId} (相关的用户进度也会被自动删除，如果设置了外键级联删除)`);
        // 6. 返回成功响应 (通常用 200 OK 或 204 No Content)
        res.status(200).json({ message: '单词删除成功' }); 
        // 或者用 res.status(204).send(); 表示成功但无内容返回

    } catch (error) {
        console.error(`删除单词时出错 (Word ID: ${wordId}):`, error);
        res.status(500).json({ message: '服务器内部错误，无法删除单词' });
    } finally {
        if (connection) {
            connection.release();
            console.log('连接已释放 - 删除单词操作结束');
        }
    }
});

// GET /api/progress/stats - 获取学习进度统计 (支持 session IDs)
app.get('/api/progress/stats', async (req, res) => {
    const userId = 1; // 固定用户 ID
    const sessionIdsParam = req.query.ids; // 尝试获取 ids 参数 '1,2,3'
    let connection;

    console.log(`请求学习统计, UserID: ${userId}, Session IDs Param: ${sessionIdsParam || 'N/A'}`);

    try {
        connection = await pool.getConnection();
        console.log('获取连接成功 - 准备查询统计数据');

        // 1. 查询总单词数 (总是需要)
        const [totalResult] = await connection.query('SELECT COUNT(*) as total_words FROM words');
        const totalWords = totalResult[0].total_words;

        // 2. 查询总掌握数 (总是需要)
        const [totalMasteredResult] = await connection.query(
            'SELECT COUNT(*) as total_mastered FROM user_progress WHERE user_id = ? AND is_mastered = 1',
            [userId]
        );
        const totalMastered = totalMasteredResult[0].total_mastered;

        // 3. 如果请求中包含 ids 参数，则计算 session 内的统计数据
        let sessionTotal = null;
        let sessionMastered = null;

        if (sessionIdsParam) {
            const sessionIds = sessionIdsParam.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id)); // 解析并验证 ID

            if (sessionIds.length > 0) {
                sessionTotal = sessionIds.length; // Session 总数就是有效 ID 的数量

                // 查询在这些 session ID 中，用户已掌握的数量
                const [sessionMasteredResult] = await connection.query(
                    'SELECT COUNT(*) as mastered_in_session FROM user_progress WHERE user_id = ? AND is_mastered = 1 AND word_id IN (?)',
                    [userId, sessionIds] // 传入 userId 和 sessionIds 数组
                );
                sessionMastered = sessionMasteredResult[0].mastered_in_session;
                console.log(`Session 内统计: 总数=<span class="math-inline">\{sessionTotal\}, 已掌握\=</span>{sessionMastered}`);
            } else {
                 console.log("提供了 ids 参数但无效或为空");
            }
        }

        // 4. 返回所有统计数据
        res.status(200).json({
            total: totalWords,             // 数据库总单词数
            mastered: totalMastered,         // 数据库总掌握数
            session_total: sessionTotal,     // session 总数 (如果请求了 session)
            session_mastered: sessionMastered // session 内掌握数 (如果请求了 session)
        });

    } catch (error) {
        console.error(`获取学习统计时出错 (UserID: ${userId}):`, error);
        res.status(500).json({ message: '服务器内部错误，无法获取学习统计' });
    } finally {
        if (connection) {
            connection.release();
            console.log('连接已释放 - 获取学习统计操作结束');
        }
    }
});
// --- GET /api/progress/stats 路由结束 ---


// GET /api/words/export - 导出所有单词为 CSV 文件
app.get('/api/words/export', async (req, res) => {
    let connection;
    try {
        connection = await pool.getConnection();
        console.log('获取连接成功 - 准备导出单词');

        // 1. 从数据库获取所有单词数据 (只选择需要的列)
        const [words] = await connection.query(
            'SELECT english_word, chinese_definition, example_sentence_en, example_sentence_cn FROM words ORDER BY word_id ASC'
        );
        console.log(`共找到 ${words.length} 个单词准备导出`);

        if (words.length === 0) {
            // 如果没有单词，可以返回空文件或提示信息
            res.setHeader('Content-Type', 'text/plain');
            return res.status(200).send('单词库为空，无法导出。');
        }

        // 2. 使用 papaparse 将 JSON 数组转换为 CSV 字符串
        //    注意：确保字段顺序和 CSV 文件预期的一致
        const csvData = Papa.unparse(words, {
            header: true, // 添加表头行
            columns: ["english_word", "chinese_definition", "example_sentence_en", "example_sentence_cn"] // 指定列顺序和名称
        });

        // 3. 设置 HTTP 响应头，告诉浏览器这是一个需要下载的 CSV 文件
        res.setHeader('Content-Type', 'text/csv; charset=utf-8'); // 指定 UTF-8 编码
        res.setHeader('Content-Disposition', 'attachment; filename="word_export.csv"'); // 指定下载文件名

        // 4. 发送 CSV 数据
        res.status(200).send(Buffer.from(csvData, 'utf-8')); // 确保以 UTF-8 发送

    } catch (error) {
        console.error('导出单词时出错:', error);
        res.status(500).json({ message: '服务器内部错误，无法导出单词' });
    } finally {
        if (connection) {
            connection.release();
            console.log('连接已释放 - 导出单词操作结束');
        }
    }
});

// POST /api/words/import - 从上传的 CSV 文件导入单词
// 使用 upload.single('csvfile') 中间件来处理名为 'csvfile' 的文件上传字段
app.post('/api/words/import', upload.single('csvfile'), async (req, res) => {
    // 检查是否有文件被上传
    if (!req.file) {
        return res.status(400).json({ message: '请选择一个 CSV 文件上传' });
    }
    console.log(`收到上传文件: ${req.file.originalname}, 大小: ${req.file.size} bytes`);

    let connection;
    let importedCount = 0;
    let skippedCount = 0;
    let processedCount = 0;

    try {
        connection = await pool.getConnection();
        console.log('获取连接成功 - 准备导入单词');

        // 1. 将内存中的文件内容 (Buffer) 转换为字符串
        const csvString = req.file.buffer.toString('utf8'); // 假设文件是 UTF-8 编码

        // 2. 使用 papaparse 解析 CSV 字符串
        //    header: true 表示第一行是表头，自动映射到对象属性
        //    skipEmptyLines: true 跳过空行
        const parseResult = Papa.parse(csvString, { header: true, skipEmptyLines: true });

        if (parseResult.errors.length > 0) {
             console.error('CSV 解析错误:', parseResult.errors);
             // 可以选择性地返回一些解析错误信息
             // throw new Error('CSV 文件格式错误或无法解析'); 
        }

        const wordsToImport = parseResult.data;
        processedCount = wordsToImport.length;
        console.log(`CSV 解析完成，共 ${processedCount} 行数据 (已跳过空行)`);

        if (processedCount === 0) {
             return res.status(400).json({ message: 'CSV 文件为空或没有有效数据行' });
        }

        // 3. 遍历解析出的单词数据并尝试插入数据库
        //    使用 INSERT IGNORE 来自动跳过 english_word 已存在的重复记录
        const sql = `
            INSERT IGNORE INTO words 
            (english_word, chinese_definition, example_sentence_en, example_sentence_cn) 
            VALUES (?, ?, ?, ?)
        `;

        for (const word of wordsToImport) {
            // 简单验证，确保关键字段存在且不为空
            const engWord = word.english_word ? word.english_word.trim() : null;
            const cnDef = word.chinese_definition ? word.chinese_definition.trim() : null;

            if (engWord && cnDef) {
                const exampleEn = word.example_sentence_en ? word.example_sentence_en.trim() : null;
                const exampleCn = word.example_sentence_cn ? word.example_sentence_cn.trim() : null;

                try {
                    const [result] = await connection.query(sql, [engWord, cnDef, exampleEn, exampleCn]);
                    if (result.affectedRows > 0) {
                        importedCount++; // 插入成功
                    } else {
                        skippedCount++; // 因为 IGNORE，没有插入说明已存在
                    }
                } catch (dbError) {
                     console.error(`数据库插入错误 for word "${engWord}":`, dbError);
                     skippedCount++; // 数据库错误也算跳过
                }
            } else {
                console.warn('跳过无效行 (缺少英文或中文):', word);
                skippedCount++; // 无效数据行算跳过
            }
        }

        console.log(`导入完成: 共处理 ${processedCount} 行, 成功导入 ${importedCount} 个单词, 跳过 ${skippedCount} 个 (重复或无效).`);

        // 4. 返回导入结果总结
        res.status(200).json({
            message: `导入完成！共处理 ${processedCount} 行，成功导入 ${importedCount} 个新单词，跳过 ${skippedCount} 个（重复或无效数据）。`,
            processed: processedCount,
            imported: importedCount,
            skipped: skippedCount
        });

    } catch (error) {
        console.error('导入单词过程中出错:', error);
        res.status(500).json({ message: `服务器内部错误: ${error.message}` });
    } finally {
        if (connection) {
            connection.release();
            console.log('连接已释放 - 导入单词操作结束');
        }
    }
});

// PUT /api/session/current - 更新当前用户的选中单词列表
app.put('/api/session/current', async (req, res) => {
    const userId = 1; // 固定用户 ID
    // 1. 从请求体获取选中的单词 ID 数组
    const { selected_ids } = req.body; 

    // 2. 验证输入是否为数组
    if (!Array.isArray(selected_ids)) {
        return res.status(400).json({ message: '请求体必须包含 selected_ids 数组' });
    }

    // 3. 验证数组内容是否为数字 (可选，但推荐)
    const validatedIds = selected_ids.map(id => Number(id)).filter(id => !isNaN(id));
    console.log(`收到更新选中列表请求, UserID: ${userId}, Validated IDs:`, validatedIds);

    // 4. 将 ID 数组转换为 JSON 字符串以便存储
    //    即使是空数组也要转换，存 '[]' 而不是 NULL，方便处理
    const idsJsonString = JSON.stringify(validatedIds); 

    let connection;
    try {
        connection = await pool.getConnection();
        console.log('获取连接成功 - 准备更新选中列表');

        // 5. 使用 INSERT ... ON DUPLICATE KEY UPDATE 更新数据库
        //    如果 user_id=1 的记录已存在，则更新 selected_word_ids；否则插入新行。
        const sql = `
            INSERT INTO current_practice_session (user_id, selected_word_ids) 
            VALUES (?, ?) 
            ON DUPLICATE KEY UPDATE selected_word_ids = VALUES(selected_word_ids);
        `;

        const [result] = await connection.query(sql, [userId, idsJsonString]);
        console.log('更新/插入选中列表成功:', result);

        // 6. 返回成功响应
        res.status(200).json({ message: '选中列表更新成功' });

    } catch (error) {
        console.error(`更新选中列表时出错 (UserID: ${userId}):`, error);
        res.status(500).json({ message: '服务器内部错误，无法更新选中列表' });
    } finally {
        if (connection) {
            connection.release();
            console.log('连接已释放 - 更新选中列表操作结束');
        }
    }
});

// GET /api/session/current - 获取当前用户的选中单词 ID 列表
app.get('/api/session/current', async (req, res) => {
    const userId = 1; // 固定用户 ID
    let connection;
    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query(
            'SELECT selected_word_ids FROM current_practice_session WHERE user_id = ?', 
            [userId]
        );

        let selectedIds = []; // 默认为空数组
        if (rows.length > 0 && rows[0].selected_word_ids) {
            try {
                const parsedIds = JSON.parse(rows[0].selected_word_ids);
                if (Array.isArray(parsedIds)) {
                    selectedIds = parsedIds.map(id => Number(id)); // 确保是数字数组
                }
            } catch(e) {
                console.error("解析 'selected_word_ids' JSON 失败 (GET):", e);
            }
        }
        res.status(200).json({ selected_ids: selectedIds });

    } catch (error) {
         console.error(`获取当前选中列表时出错 (UserID: ${userId}):`, error);
         res.status(500).json({ message: '服务器内部错误，无法获取当前选中列表' });
    } finally {
        if (connection) connection.release();
    }
});

// PUT /api/progress/reset/:word_id - 将指定单词（针对默认用户1）标记为未掌握
app.put('/api/progress/reset/:word_id', async (req, res) => {
    const userId = 1; // 固定用户 ID，因为我们是单用户（Mumu）上下文
    const wordIdToReset = parseInt(req.params.word_id, 10);

    if (isNaN(wordIdToReset)) {
        return res.status(400).json({ message: '无效的单词 ID' });
    }

    console.log(`请求重置单词掌握状态, UserID: ${userId}, WordID: ${wordIdToReset}`);
    let connection;
    try {
        connection = await pool.getConnection();
        console.log('获取连接成功 - 准备重置单词进度');

        // 检查 user_progress 表中是否存在该用户对该单词的记录
        const [existingProgress] = await connection.query(
            'SELECT progress_id FROM user_progress WHERE user_id = ? AND word_id = ?',
            [userId, wordIdToReset]
        );

        let result;
        if (existingProgress.length > 0) {
            // 如果记录存在，则更新 is_mastered = 0, correct_streak = 0
            const sql = `
                UPDATE user_progress 
                SET is_mastered = 0, correct_streak = 0, last_answered_timestamp = NOW() 
                WHERE user_id = ? AND word_id = ?;
            `;
            [result] = await connection.query(sql, [userId, wordIdToReset]);
            console.log(`单词 (ID: ${wordIdToReset}) 进度已更新为未掌握.`);
        } else {
            // 如果记录不存在，则插入一条新的未掌握记录
            // 这确保了即使单词从未练习过，也能在 user_progress 中明确标记为未掌握状态，
            // 虽然通常情况下，如果不在 user_progress 里，默认就是未掌握。
            // 但为了确保状态明确，可以插入。
            const insertSql = `
                INSERT INTO user_progress (user_id, word_id, is_mastered, correct_streak, last_answered_timestamp)
                VALUES (?, ?, 0, 0, NOW())
                ON DUPLICATE KEY UPDATE -- 以防万一，如果并发插入，则进行更新
                    is_mastered = 0, 
                    correct_streak = 0, 
                    last_answered_timestamp = NOW();
            `;
            [result] = await connection.query(insertSql, [userId, wordIdToReset]);
            console.log(`单词 (ID: ${wordIdToReset}) 进度已插入为未掌握.`);
        }

        // result.affectedRows > 0 (for UPDATE) or result.insertId > 0 (for INSERT)
        if (result.affectedRows > 0 || result.insertId > 0) {
             res.status(200).json({ message: '单词掌握状态已重置' });
        } else {
             // 理论上，如果单词ID存在于words表，上面逻辑总会影响一行（更新或插入）。
             // 如果到这里，可能是word_id不存在于words表，导致外键约束失败（如果user_progress有外键到words表的话）
             // 或者其他未预料的情况。
             console.warn(`重置进度操作未明确影响行 (WordID: ${wordIdToReset}):`, result);
             res.status(404).json({ message: '操作未影响任何记录 (可能单词ID不存在或无对应进度)' });
        }

    } catch (error) {
        console.error(`重置单词掌握状态时出错 (WordID: ${wordIdToReset}):`, error);
        // 检查是否是外键约束错误 (如果 word_id 不存在于 words 表)
        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
             return res.status(404).json({ message: `操作失败：单词 ID ${wordIdToReset} 不存在于单词库中。` });
        }
        res.status(500).json({ message: '服务器内部错误，无法重置状态' });
    } finally {
        if (connection) {
            connection.release();
            console.log('连接已释放 - 重置单词掌握状态操作结束');
        }
    }
});

// ... (后面是 app.listen(...) 和 process.on(...) 等代码)
// 启动服务器，监听指定端口
app.listen(port, () => {
    console.log(`后端服务已启动，运行在 http://localhost:${port}`);
});



// 添加一些错误处理，比如监听未处理的 Promise 拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason);
  // 可以在这里添加更详细的日志记录或退出逻辑
});