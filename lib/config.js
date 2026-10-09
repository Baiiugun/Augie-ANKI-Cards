// 【临时测试系统】公开配置。anon 公开密钥按设计就是可以出现在网页里的；service_role 万能密钥绝不出现在任何文件里。
export const SUPABASE_URL = 'https://br-cute-tahr-8eff7472.supabase.aidap-global.cn-beijing.volces.com';
export const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1wbGF0Zm9ybSIsInJvbGUiOiJhbm9uIiwiZXhwIjozNjg2OTI1NzYzfQ.y45vSsbxFjV9k-psYujSR2YMtDOeZW_IDZS6eBlbRFc';
export const BUCKET = 'anki-test-media';

// 媒体文件地址：默认走 Supabase Storage；本地测试时 ?media=local 改走 /_media/
export function mediaBase(slug) {
  const local = new URLSearchParams(location.search).get('media') === 'local';
  return local ? `/_media/${slug}/` : `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${slug}/`;
}
