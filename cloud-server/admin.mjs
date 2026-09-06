import crypto from 'node:crypto'
import zlib from 'node:zlib'
import {
  ADMIN_ROLES,
  hashPassword,
  hasPermission,
  normalizeLiterature,
  normalizeText,
  parsePagination,
  safeEqualText,
  signAdminToken,
  validateAdminUsername,
  validateStrongPassword,
  verifyAdminToken
} from './admin-core.mjs'

const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || ''
const BOOTSTRAP_TOKEN = process.env.ADMIN_BOOTSTRAP_TOKEN || ''
const LOGIN_LIMIT = Math.max(3, Number(process.env.ADMIN_LOGIN_LIMIT_PER_15M || 10))
const loginBuckets = new Map()

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }) }
function id() { return crypto.randomUUID() }
function bearer(req) { const value = String(req.headers.authorization || ''); return value.startsWith('Bearer ') ? value.slice(7) : '' }
function integer(value, min, max, label) { const n = Number(value); if (!Number.isSafeInteger(n) || n < min || n > max) fail(`${label}无效`); return n }
function cleanStatus(value, allowed, fallback) { const status = normalizeText(value, 40); return allowed.includes(status) ? status : fallback }
function allowedOrigin(origin, configured) {
  const list = String(configured || '').split(',').map((x) => x.trim()).filter(Boolean)
  return !origin || list.includes(origin) || list.includes('*')
}
function checkLoginRate(ip) {
  const key = String(ip || 'unknown').slice(0, 128), now = Date.now(), current = loginBuckets.get(key)
  if (!current || current.resetAt <= now) { loginBuckets.set(key, { count: 1, resetAt: now + 15 * 60_000 }); return }
  current.count += 1
  if (current.count > LOGIN_LIMIT) fail('管理员登录尝试过多，请稍后再试', 429)
}
function jsonRow(row) {
  if (!row) return row
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, x) => x.toUpperCase()), value]))
}

export function createAdminRouter({ pool, json, body, clientIp, corsOrigin }) {
  if (ADMIN_SECRET.length < 32) throw new Error('ADMIN_JWT_SECRET or JWT_SECRET must contain at least 32 characters')

  async function audit(client, admin, req, action, entityType, entityId = '', metadata = {}) {
    await client.query(
      `INSERT INTO admin_audit_logs(id,admin_id,action,entity_type,entity_id,ip,user_agent,metadata)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id(), admin.id, action, entityType, entityId || null, clientIp(req), normalizeText(req.headers['user-agent'], 500), metadata]
    )
  }

  async function principal(req, permission) {
    const payload = verifyAdminToken(bearer(req), ADMIN_SECRET)
    if (!payload) fail('管理员登录已失效，请重新登录', 401)
    const { rows } = await pool.query('SELECT id,username,display_name,role,active FROM admins WHERE id=$1', [payload.sub])
    const admin = rows[0]
    if (!admin || !admin.active) fail('管理员账号已停用', 403)
    if (!hasPermission(admin.role, permission)) fail('当前管理员没有此操作权限', 403)
    return admin
  }

  async function dashboard() {
    const { rows } = await pool.query(`SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM literature_documents WHERE status='published') AS published_literature,
      (SELECT count(*)::int FROM orders WHERE status='paid') AS paid_orders,
      (SELECT coalesce(sum(amount_cents),0)::bigint FROM orders WHERE status='paid') AS revenue_cents,
      (SELECT coalesce(sum(balance),0)::bigint FROM credit_accounts) AS outstanding_credits,
      (SELECT count(*)::int FROM admin_audit_logs WHERE created_at > now()-interval '24 hours') AS operations_24h`)
    return jsonRow(rows[0])
  }

  async function publicLiterature(url) {
    const { page, limit, offset } = parsePagination(url, { limit: 24, max: 100 })
    const q = normalizeText(url.searchParams.get('q'), 300)
    const category = normalizeText(url.searchParams.get('category'), 80)
    const values = []
    const where = [`l.status='published'`]
    if (q) { values.push(`%${q}%`); where.push(`(l.title ILIKE $${values.length} OR l.abstract ILIKE $${values.length} OR array_to_string(l.authors,' ') ILIKE $${values.length})`) }
    if (category) { values.push(category); where.push(`(c.slug=$${values.length} OR c.id::text=$${values.length})`) }
    values.push(limit, offset)
    const list = await pool.query(`SELECT l.id,l.title,l.authors,l.year,l.doi,l.url,l.abstract,l.keywords,l.source,l.updated_at,c.name category,c.slug category_slug
      FROM literature_documents l LEFT JOIN literature_categories c ON c.id=l.category_id
      WHERE ${where.join(' AND ')} ORDER BY l.updated_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)
    const count = await pool.query(`SELECT count(*)::int total FROM literature_documents l LEFT JOIN literature_categories c ON c.id=l.category_id WHERE ${where.join(' AND ')}`, values.slice(0, -2))
    return { items: list.rows.map(jsonRow), page, limit, total: count.rows[0].total }
  }

  async function createBackup(admin, req) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const tables = ['users','credit_accounts','credit_ledger','orders','recharge_records','literature_categories','literature_documents','admins','admin_audit_logs']
      const snapshot = { format: 'jiege-cloud-backup-v1', createdAt: new Date().toISOString(), tables: {} }
      for (const table of tables) snapshot.tables[table] = (await client.query(`SELECT * FROM ${table}`)).rows
      await client.query('COMMIT')
      const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(snapshot)))
      if (compressed.length > 100 * 1024 * 1024) fail('备份超过 100 MB 上限，请改用 pg_dump', 413)
      const checksum = crypto.createHash('sha256').update(compressed).digest('hex')
      const backupId = id()
      const writer = await pool.connect()
      try {
        await writer.query('BEGIN')
        await writer.query(`INSERT INTO database_backups(id,created_by,format,size_bytes,sha256,payload) VALUES($1,$2,'json.gz',$3,$4,$5)`, [backupId, admin.id, compressed.length, checksum, compressed])
        await audit(writer, admin, req, 'backup.create', 'database_backup', backupId, { sizeBytes: compressed.length, sha256: checksum })
        await writer.query('COMMIT')
      } catch (error) { await writer.query('ROLLBACK'); throw error } finally { writer.release() }
      return { id: backupId, sizeBytes: compressed.length, sha256: checksum, downloadUrl: `/v1/admin/backups/${backupId}/download` }
    } catch (error) { try { await client.query('ROLLBACK') } catch {}; throw error } finally { client.release() }
  }

  return async function routeAdmin(req, res, url, cors) {
    if (url.pathname === '/v1/public/literature' && req.method === 'GET') { json(res, 200, await publicLiterature(url), cors); return true }
    if (url.pathname === '/v1/public/literature/categories' && req.method === 'GET') {
      const { rows } = await pool.query(`SELECT id,name,slug,description,(SELECT count(*)::int FROM literature_documents l WHERE l.category_id=c.id AND l.status='published') item_count FROM literature_categories c WHERE active=true ORDER BY sort_order,name`)
      json(res, 200, { items: rows.map(jsonRow) }, cors); return true
    }
    if (!url.pathname.startsWith('/v1/admin/')) return false
    const origin = String(req.headers.origin || '')
    if (!allowedOrigin(origin, corsOrigin)) fail('管理后台来源未获授权', 403)

    if (url.pathname === '/v1/admin/bootstrap/status' && req.method === 'GET') {
      const { rows } = await pool.query('SELECT EXISTS(SELECT 1 FROM admins) configured')
      json(res, 200, { configured: rows[0].configured }, cors); return true
    }
    if (url.pathname === '/v1/admin/bootstrap' && req.method === 'POST') {
      if (!BOOTSTRAP_TOKEN || !safeEqualText(req.headers['x-bootstrap-token'] || '', BOOTSTRAP_TOKEN)) fail('初始化令牌无效', 401)
      const input = await body(req, 64 * 1024), username = validateAdminUsername(input.username), password = validateStrongPassword(input.password)
      const salt = crypto.randomBytes(16).toString('hex'), adminId = id(), displayName = normalizeText(input.displayName, 80) || username
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query("SELECT pg_advisory_xact_lock(hashtext('jiege-admin-bootstrap'))")
        const { rows } = await client.query('SELECT EXISTS(SELECT 1 FROM admins) configured')
        if (rows[0].configured) fail('管理员已初始化，初始化入口已永久关闭', 409)
        await client.query(`INSERT INTO admins(id,username,display_name,password_hash,password_salt,role) VALUES($1,$2,$3,$4,$5,'owner')`, [adminId, username, displayName, hashPassword(password, salt), salt])
        await audit(client, { id: adminId }, req, 'admin.bootstrap', 'admin', adminId, { username })
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
      json(res, 201, { ok: true }, cors); return true
    }
    if (url.pathname === '/v1/admin/login' && req.method === 'POST') {
      checkLoginRate(clientIp(req))
      const input = await body(req, 64 * 1024), username = validateAdminUsername(input.username), password = String(input.password || '')
      const { rows } = await pool.query('SELECT * FROM admins WHERE username=$1', [username]); const admin = rows[0]
      if (!admin || !admin.active || !safeEqualText(hashPassword(password, admin.password_salt), admin.password_hash)) fail('管理员账号或密码不正确', 401)
      await pool.query('UPDATE admins SET last_login_at=now(),updated_at=now() WHERE id=$1', [admin.id])
      await audit(pool, admin, req, 'admin.login', 'admin', admin.id)
      json(res, 200, { token: signAdminToken(admin, ADMIN_SECRET), admin: { id: admin.id, username: admin.username, displayName: admin.display_name, role: admin.role } }, cors); return true
    }

    if (url.pathname === '/v1/admin/me' && req.method === 'GET') { const admin = await principal(req, 'dashboard'); json(res, 200, { admin: jsonRow(admin) }, cors); return true }
    if (url.pathname === '/v1/admin/dashboard' && req.method === 'GET') { await principal(req, 'dashboard'); json(res, 200, await dashboard(), cors); return true }

    if (url.pathname === '/v1/admin/categories' && req.method === 'GET') {
      await principal(req, 'literature'); const { rows } = await pool.query('SELECT * FROM literature_categories ORDER BY sort_order,name'); json(res, 200, { items: rows.map(jsonRow) }, cors); return true
    }
    if (url.pathname === '/v1/admin/categories' && req.method === 'POST') {
      const admin = await principal(req, 'literature'), input = await body(req), name = normalizeText(input.name, 120), slug = normalizeText(input.slug, 120).toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
      if (!name || !slug) fail('分类名称和英文标识不能为空')
      const itemId = id(), client = await pool.connect()
      try { await client.query('BEGIN'); const { rows } = await client.query('INSERT INTO literature_categories(id,name,slug,description,sort_order) VALUES($1,$2,$3,$4,$5) RETURNING *',[itemId,name,slug,normalizeText(input.description,1000),integer(input.sortOrder ?? 0,-100000,100000,'排序值')]); await audit(client,admin,req,'category.create','literature_category',itemId,{name}); await client.query('COMMIT'); json(res,201,{item:jsonRow(rows[0])},cors) } catch(error){await client.query('ROLLBACK');throw error} finally{client.release()} return true
    }
    const categoryMatch=url.pathname.match(/^\/v1\/admin\/categories\/([0-9a-f-]+)$/i)
    if(categoryMatch&&req.method==='PATCH'){
      const admin=await principal(req,'literature'),input=await body(req),name=normalizeText(input.name,120),slug=normalizeText(input.slug,120).toLowerCase().replace(/[^a-z0-9_-]+/g,'-');if(!name||!slug)fail('分类名称和英文标识不能为空')
      const client=await pool.connect();try{await client.query('BEGIN');const{rows}=await client.query(`UPDATE literature_categories SET name=$2,slug=$3,description=$4,sort_order=$5,active=$6,updated_at=now() WHERE id=$1 RETURNING *`,[categoryMatch[1],name,slug,normalizeText(input.description,1000),integer(input.sortOrder??0,-100000,100000,'排序值'),input.active!==false]);if(!rows[0])fail('分类不存在',404);await audit(client,admin,req,'category.update','literature_category',categoryMatch[1],{name,active:input.active!==false});await client.query('COMMIT');json(res,200,{item:jsonRow(rows[0])},cors)}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}return true
    }

    if (url.pathname === '/v1/admin/literature' && req.method === 'GET') {
      await principal(req, 'literature'); const { page, limit, offset } = parsePagination(url); const q=normalizeText(url.searchParams.get('q'),300),status=normalizeText(url.searchParams.get('status'),40); const values=[]; const where=['1=1']
      if(q){values.push(`%${q}%`);where.push(`(l.title ILIKE $${values.length} OR l.doi ILIKE $${values.length})`)} if(status){values.push(status);where.push(`l.status=$${values.length}`)} values.push(limit,offset)
      const list=await pool.query(`SELECT l.*,c.name category_name FROM literature_documents l LEFT JOIN literature_categories c ON c.id=l.category_id WHERE ${where.join(' AND ')} ORDER BY l.updated_at DESC LIMIT $${values.length-1} OFFSET $${values.length}`,values)
      const count=await pool.query(`SELECT count(*)::int total FROM literature_documents l WHERE ${where.join(' AND ')}`,values.slice(0,-2)); json(res,200,{items:list.rows.map(jsonRow),page,limit,total:count.rows[0].total},cors); return true
    }
    if (url.pathname === '/v1/admin/literature' && req.method === 'POST') {
      const admin=await principal(req,'literature'),item=normalizeLiterature(await body(req)),itemId=id(),client=await pool.connect()
      try{await client.query('BEGIN');const{rows}=await client.query(`INSERT INTO literature_documents(id,title,authors,year,doi,url,abstract,keywords,category_id,status,source,notes,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,[itemId,item.title,item.authors,item.year,item.doi,item.url,item.abstract,item.keywords,item.categoryId,item.status,item.source,item.notes,admin.id]);await audit(client,admin,req,'literature.create','literature',itemId,{title:item.title,status:item.status});await client.query('COMMIT');json(res,201,{item:jsonRow(rows[0])},cors)}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}return true
    }
    if (url.pathname === '/v1/admin/literature/bulk' && req.method === 'POST') {
      const admin=await principal(req,'literature'),input=await body(req,8*1024*1024),items=Array.isArray(input.items)?input.items:[];if(!items.length||items.length>1000)fail('批量导入需包含 1 至 1000 条文献')
      const client=await pool.connect(),result={created:0,updated:0,errors:[]}
      try{await client.query('BEGIN');for(let i=0;i<items.length;i+=1){try{const item=normalizeLiterature(items[i]),itemId=id();const existing=item.doi?await client.query(`SELECT id FROM literature_documents WHERE lower(doi)=lower($1) LIMIT 1`,[item.doi]):{rows:[]};if(existing.rows[0]){await client.query(`UPDATE literature_documents SET title=$2,authors=$3,year=$4,url=$5,abstract=$6,keywords=$7,category_id=$8,status=$9,source=$10,notes=$11,updated_by=$12,updated_at=now() WHERE id=$1`,[existing.rows[0].id,item.title,item.authors,item.year,item.url,item.abstract,item.keywords,item.categoryId,item.status,item.source,item.notes,admin.id]);result.updated+=1}else{await client.query(`INSERT INTO literature_documents(id,title,authors,year,doi,url,abstract,keywords,category_id,status,source,notes,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,[itemId,item.title,item.authors,item.year,item.doi,item.url,item.abstract,item.keywords,item.categoryId,item.status,item.source,item.notes,admin.id]);result.created+=1}}catch(error){result.errors.push({row:i+1,message:String(error.message||error).slice(0,300)})}}await audit(client,admin,req,'literature.bulk_import','literature','',{count:items.length,created:result.created,updated:result.updated,errors:result.errors.length});await client.query('COMMIT');json(res,200,result,cors)}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}return true
    }
    const literatureMatch=url.pathname.match(/^\/v1\/admin\/literature\/([0-9a-f-]+)$/i)
    if(literatureMatch&&req.method==='PATCH'){
      const admin=await principal(req,'literature'),item=normalizeLiterature(await body(req)),client=await pool.connect()
      try{await client.query('BEGIN');const{rows}=await client.query(`UPDATE literature_documents SET title=$2,authors=$3,year=$4,doi=$5,url=$6,abstract=$7,keywords=$8,category_id=$9,status=$10,source=$11,notes=$12,updated_by=$13,updated_at=now() WHERE id=$1 RETURNING *`,[literatureMatch[1],item.title,item.authors,item.year,item.doi,item.url,item.abstract,item.keywords,item.categoryId,item.status,item.source,item.notes,admin.id]);if(!rows[0])fail('文献不存在',404);await audit(client,admin,req,'literature.update','literature',literatureMatch[1],{title:item.title,status:item.status});await client.query('COMMIT');json(res,200,{item:jsonRow(rows[0])},cors)}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}return true
    }
    const unpublishMatch=url.pathname.match(/^\/v1\/admin\/literature\/([0-9a-f-]+)\/unpublish$/i)
    if(unpublishMatch&&req.method==='POST'){const admin=await principal(req,'literature'),client=await pool.connect();try{await client.query('BEGIN');const{rows}=await client.query(`UPDATE literature_documents SET status='withdrawn',updated_by=$2,updated_at=now() WHERE id=$1 RETURNING *`,[unpublishMatch[1],admin.id]);if(!rows[0])fail('文献不存在',404);await audit(client,admin,req,'literature.unpublish','literature',unpublishMatch[1]);await client.query('COMMIT');json(res,200,{item:jsonRow(rows[0])},cors)}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}return true}

    if(url.pathname==='/v1/admin/users'&&req.method==='GET'){await principal(req,'users');const{page,limit,offset}=parsePagination(url),q=normalizeText(url.searchParams.get('q'),300);const values=q?[`%${q}%`,limit,offset]:[limit,offset];const where=q?'WHERE u.email ILIKE $1 OR u.display_name ILIKE $1':'';const l=q?2:1,o=q?3:2;const list=await pool.query(`SELECT u.id,u.email,u.display_name,u.status,u.created_at,u.updated_at,a.balance,a.purchased_total,a.spent_total FROM users u JOIN credit_accounts a ON a.user_id=u.id ${where} ORDER BY u.created_at DESC LIMIT $${l} OFFSET $${o}`,values);const count=await pool.query(`SELECT count(*)::int total FROM users u ${where}`,q?[values[0]]:[]);json(res,200,{items:list.rows.map(jsonRow),page,limit,total:count.rows[0].total},cors);return true}
    const userStatusMatch=url.pathname.match(/^\/v1\/admin\/users\/([0-9a-f-]+)\/status$/i)
    if(userStatusMatch&&req.method==='PATCH'){const admin=await principal(req,'users'),input=await body(req),status=cleanStatus(input.status,['active','suspended','closed'],'active'),client=await pool.connect();try{await client.query('BEGIN');const{rows}=await client.query('UPDATE users SET status=$2,updated_at=now() WHERE id=$1 RETURNING id,email,display_name,status,updated_at',[userStatusMatch[1],status]);if(!rows[0])fail('用户不存在',404);await audit(client,admin,req,'user.status','user',userStatusMatch[1],{status});await client.query('COMMIT');json(res,200,{item:jsonRow(rows[0])},cors)}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}return true}
    const balanceMatch=url.pathname.match(/^\/v1\/admin\/users\/([0-9a-f-]+)\/balance$/i)
    if(balanceMatch&&req.method==='POST'){const admin=await principal(req,'balances'),input=await body(req),delta=integer(input.delta,-10000000,10000000,'积分变更'),reason=normalizeText(input.reason,500);if(!delta||!reason)fail('积分变更值和原因不能为空');const client=await pool.connect();try{await client.query('BEGIN');const locked=await client.query('SELECT balance FROM credit_accounts WHERE user_id=$1 FOR UPDATE',[balanceMatch[1]]);if(!locked.rows[0])fail('用户不存在',404);const next=Number(locked.rows[0].balance)+delta;if(next<0)fail('余额不能小于 0');await client.query('UPDATE credit_accounts SET balance=$2,purchased_total=purchased_total+GREATEST($3,0),updated_at=now() WHERE user_id=$1',[balanceMatch[1],next,delta]);const ledgerId=id();await client.query(`INSERT INTO credit_ledger(id,user_id,delta,reason,external_id) VALUES($1,$2,$3,$4,$5)`,[ledgerId,balanceMatch[1],delta,`管理员调整：${reason}`,`admin:${ledgerId}`]);await audit(client,admin,req,'balance.adjust','user',balanceMatch[1],{delta,reason,balance:next});await client.query('COMMIT');json(res,200,{balance:next},cors)}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}return true}

    if(url.pathname==='/v1/admin/orders'&&req.method==='GET'){await principal(req,'orders');const{page,limit,offset}=parsePagination(url),status=normalizeText(url.searchParams.get('status'),40),values=status?[status,limit,offset]:[limit,offset],where=status?'WHERE o.status=$1':'',l=status?2:1,o=status?3:2;const list=await pool.query(`SELECT o.*,u.email,u.display_name FROM orders o JOIN users u ON u.id=o.user_id ${where} ORDER BY o.created_at DESC LIMIT $${l} OFFSET $${o}`,values);const count=await pool.query(`SELECT count(*)::int total FROM orders o ${where}`,status?[status]:[]);json(res,200,{items:list.rows.map(jsonRow),page,limit,total:count.rows[0].total},cors);return true}
    if(url.pathname==='/v1/admin/orders'&&req.method==='POST'){const admin=await principal(req,'orders'),input=await body(req),userId=normalizeText(input.userId,80),credits=integer(input.credits,1,10000000,'积分'),amountCents=integer(input.amountCents??0,0,1000000000,'金额'),currency=normalizeText(input.currency||'cny',8).toLowerCase(),orderId=id(),client=await pool.connect();try{await client.query('BEGIN');const user=await client.query('SELECT 1 FROM users WHERE id=$1',[userId]);if(!user.rows[0])fail('用户不存在',404);const{rows}=await client.query(`INSERT INTO orders(id,user_id,provider,amount_cents,currency,credits,status,metadata) VALUES($1,$2,'manual',$3,$4,$5,'pending',$6) RETURNING *`,[orderId,userId,amountCents,currency,credits,{note:normalizeText(input.note,500)}]);await audit(client,admin,req,'order.create','order',orderId,{userId,credits,amountCents,currency});await client.query('COMMIT');json(res,201,{item:jsonRow(rows[0])},cors)}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}return true}
    const orderMatch=url.pathname.match(/^\/v1\/admin\/orders\/([0-9a-f-]+)$/i)
    if(orderMatch&&req.method==='PATCH'){const admin=await principal(req,'orders'),input=await body(req),status=normalizeText(input.status,40);if(!['paid','cancelled','refunded'].includes(status))fail('订单状态无效');const client=await pool.connect();try{await client.query('BEGIN');const current=await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[orderMatch[1]]),order=current.rows[0];if(!order)fail('订单不存在',404);const transitions={pending:['paid','cancelled'],failed:['paid','cancelled'],paid:['refunded'],cancelled:[],refunded:[]};if(status!==order.status&&!transitions[order.status]?.includes(status))fail(`订单不能从 ${order.status} 变更为 ${status}`,409);if(status==='paid'&&order.status!=='paid'){const ledgerId=id(),externalId=`manual-order:${order.id}`;await client.query('UPDATE credit_accounts SET balance=balance+$2,purchased_total=purchased_total+$2,updated_at=now() WHERE user_id=$1',[order.user_id,order.credits]);await client.query(`INSERT INTO credit_ledger(id,user_id,delta,reason,external_id) VALUES($1,$2,$3,'Manual order',$4)`,[ledgerId,order.user_id,order.credits,externalId]);await client.query(`INSERT INTO recharge_records(id,user_id,order_id,credits,amount_cents,currency,provider,external_id,status) VALUES($1,$2,$3,$4,$5,$6,'manual',$7,'completed')`,[id(),order.user_id,order.id,order.credits,order.amount_cents,order.currency,externalId])}if(status==='refunded'&&order.status==='paid'){const account=await client.query('SELECT balance FROM credit_accounts WHERE user_id=$1 FOR UPDATE',[order.user_id]);if(Number(account.rows[0]?.balance||0)<Number(order.credits))fail('用户当前余额不足，不能自动退款扣回积分',409);const ledgerId=id();await client.query('UPDATE credit_accounts SET balance=balance-$2,purchased_total=GREATEST(0,purchased_total-$2),updated_at=now() WHERE user_id=$1',[order.user_id,order.credits]);await client.query(`INSERT INTO credit_ledger(id,user_id,delta,reason,external_id) VALUES($1,$2,$3,'Order refund',$4)`,[ledgerId,order.user_id,-order.credits,`refund-order:${order.id}`]);await client.query(`UPDATE recharge_records SET status='refunded' WHERE order_id=$1`,[order.id])}const{rows}=await client.query(`UPDATE orders SET status=$2,paid_at=CASE WHEN $2='paid' AND paid_at IS NULL THEN now() ELSE paid_at END,updated_at=now() WHERE id=$1 RETURNING *`,[order.id,status]);if(status!==order.status)await audit(client,admin,req,'order.status','order',order.id,{from:order.status,to:status});await client.query('COMMIT');json(res,200,{item:jsonRow(rows[0])},cors)}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}return true}
    if(url.pathname==='/v1/admin/recharges'&&req.method==='GET'){await principal(req,'orders');const{page,limit,offset}=parsePagination(url);const list=await pool.query(`SELECT r.*,u.email,u.display_name FROM recharge_records r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC LIMIT $1 OFFSET $2`,[limit,offset]);const count=await pool.query('SELECT count(*)::int total FROM recharge_records');json(res,200,{items:list.rows.map(jsonRow),page,limit,total:count.rows[0].total},cors);return true}

    if(url.pathname==='/v1/admin/logs'&&req.method==='GET'){await principal(req,'logs');const{page,limit,offset}=parsePagination(url,{limit:100,max:300});const list=await pool.query(`SELECT l.*,a.username FROM admin_audit_logs l JOIN admins a ON a.id=l.admin_id ORDER BY l.created_at DESC LIMIT $1 OFFSET $2`,[limit,offset]);const count=await pool.query('SELECT count(*)::int total FROM admin_audit_logs');json(res,200,{items:list.rows.map(jsonRow),page,limit,total:count.rows[0].total},cors);return true}
    if(url.pathname==='/v1/admin/backups'&&req.method==='GET'){await principal(req,'backups');const{rows}=await pool.query('SELECT id,format,size_bytes,sha256,created_at,expires_at FROM database_backups ORDER BY created_at DESC LIMIT 50');json(res,200,{items:rows.map(jsonRow)},cors);return true}
    if(url.pathname==='/v1/admin/backups'&&req.method==='POST'){const admin=await principal(req,'backups');json(res,201,{backup:await createBackup(admin,req)},cors);return true}
    const backupMatch=url.pathname.match(/^\/v1\/admin\/backups\/([0-9a-f-]+)\/download$/i)
    if(backupMatch&&req.method==='GET'){await principal(req,'backups');const{rows}=await pool.query('SELECT payload,sha256 FROM database_backups WHERE id=$1 AND (expires_at IS NULL OR expires_at>now())',[backupMatch[1]]);if(!rows[0])fail('备份不存在或已过期',404);res.writeHead(200,{...cors,'content-type':'application/gzip','content-disposition':`attachment; filename="jiege-cloud-${backupMatch[1]}.json.gz"`,'x-checksum-sha256':rows[0].sha256,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(rows[0].payload);return true}

    if(url.pathname==='/v1/admin/admins'&&req.method==='GET'){await principal(req,'admins');const{rows}=await pool.query('SELECT id,username,display_name,role,active,last_login_at,created_at,updated_at FROM admins ORDER BY created_at');json(res,200,{items:rows.map(jsonRow),roles:ADMIN_ROLES},cors);return true}
    if(url.pathname==='/v1/admin/admins'&&req.method==='POST'){const owner=await principal(req,'admins'),input=await body(req),username=validateAdminUsername(input.username),password=validateStrongPassword(input.password),role=ADMIN_ROLES.includes(input.role)?input.role:'viewer',salt=crypto.randomBytes(16).toString('hex'),adminId=id(),client=await pool.connect();try{await client.query('BEGIN');const{rows}=await client.query('INSERT INTO admins(id,username,display_name,password_hash,password_salt,role) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,username,display_name,role,active,created_at',[adminId,username,normalizeText(input.displayName,80)||username,hashPassword(password,salt),salt,role]);await audit(client,owner,req,'admin.create','admin',adminId,{username,role});await client.query('COMMIT');json(res,201,{item:jsonRow(rows[0])},cors)}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}return true}
    const adminMatch=url.pathname.match(/^\/v1\/admin\/admins\/([0-9a-f-]+)$/i)
    if(adminMatch&&req.method==='PATCH'){const owner=await principal(req,'admins'),input=await body(req),role=ADMIN_ROLES.includes(input.role)?input.role:null;if(!role||typeof input.active!=='boolean')fail('管理员角色或状态无效');if(adminMatch[1]===owner.id&&input.active===false)fail('不能停用当前登录的管理员',409);const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('jiege-admin-owner-guard'))");if(input.active===false){const activeOwners=await client.query("SELECT count(*)::int total FROM admins WHERE role='owner' AND active=true");const target=await client.query('SELECT role,active FROM admins WHERE id=$1 FOR UPDATE',[adminMatch[1]]);if(!target.rows[0])fail('管理员不存在',404);if(target.rows[0].role==='owner'&&target.rows[0].active&&activeOwners.rows[0].total<=1)fail('不能停用最后一个 Owner',409)}if(role!=='owner'){const activeOwners=await client.query("SELECT count(*)::int total FROM admins WHERE role='owner' AND active=true");const target=await client.query('SELECT role,active FROM admins WHERE id=$1 FOR UPDATE',[adminMatch[1]]);if(!target.rows[0])fail('管理员不存在',404);if(target.rows[0].role==='owner'&&target.rows[0].active&&activeOwners.rows[0].total<=1)fail('不能降级最后一个 Owner',409)}const{rows}=await client.query('UPDATE admins SET role=$2,active=$3,updated_at=now() WHERE id=$1 RETURNING id,username,display_name,role,active,last_login_at,created_at,updated_at',[adminMatch[1],role,input.active]);if(!rows[0])fail('管理员不存在',404);await audit(client,owner,req,'admin.update','admin',adminMatch[1],{role,active:input.active});await client.query('COMMIT');json(res,200,{item:jsonRow(rows[0])},cors)}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}return true}
    return false
  }
}
