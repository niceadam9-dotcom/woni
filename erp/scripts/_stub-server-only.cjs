// 프로브 전용 — `server-only` 가드를 무력화한다.
//
// 왜 필요한가: 위임장 조립(assembleDelegation)은 lib/supabase/admin을 통해 DB를 읽는데
// 그 파일이 `server-only`를 import 한다. 프로브는 Next 런타임 밖의 node라 그 가드에 걸린다.
// 가드의 목적은 **서비스 롤 키가 클라이언트 번들로 새는 것**을 막는 것이고, 프로브는 번들이
// 아니라 로컬 node 프로세스다 — 목적을 해치지 않는다.
//
// ⚠ 이 파일은 **프로브에서만** --require로 넣는다. 앱 코드·빌드 경로에 절대 넣지 말 것.
const path = require.resolve('server-only')
require.cache[path] = { id: path, filename: path, loaded: true, exports: {}, children: [], paths: [] }
