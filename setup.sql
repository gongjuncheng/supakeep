-- ============================================================
-- SupaKeep 建表脚本
-- 在 Supabase 项目 -> SQL Editor 中执行
-- 仅包含 CREATE / ALTER / INSERT，可安全重复执行
-- ============================================================

-- 1. 保活心跳表（定期被查询，让 Supabase 认为有活动）
CREATE TABLE IF NOT EXISTS public.keepalive (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  pinged_at timestamptz NOT NULL DEFAULT now()
);

-- 2. 保活日志表（每次保活写入一条，作为审计证据）
CREATE TABLE IF NOT EXISTS public.keepalive_logs (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  project_id text NOT NULL,
  status int NOT NULL,
  latency_ms int,
  pinged_at timestamptz NOT NULL DEFAULT now()
);

-- 3. 开启行级安全
ALTER TABLE public.keepalive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keepalive_logs ENABLE ROW LEVEL SECURITY;

-- 4. 匿名读写策略（已存在则跳过）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'keepalive' AND policyname = 'allow_anon_select') THEN
    CREATE POLICY "allow_anon_select" ON public.keepalive FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'keepalive_logs' AND policyname = 'allow_anon_select_logs') THEN
    CREATE POLICY "allow_anon_select_logs" ON public.keepalive_logs FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'keepalive' AND policyname = 'allow_anon_insert') THEN
    CREATE POLICY "allow_anon_insert" ON public.keepalive FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'keepalive_logs' AND policyname = 'allow_anon_insert_logs') THEN
    CREATE POLICY "allow_anon_insert_logs" ON public.keepalive_logs FOR INSERT TO anon WITH CHECK (true);
  END IF;
END $$;

-- 5. 插入初始记录（让 keepalive 表至少有一条数据）
INSERT INTO public.keepalive DEFAULT VALUES;
