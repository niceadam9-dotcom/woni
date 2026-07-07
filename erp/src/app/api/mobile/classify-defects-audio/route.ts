import { NextResponse } from 'next/server'

// Claude API는 오디오 직접 입력을 지원하지 않습니다.
// 모바일 앱에서 expo-speech 등으로 텍스트 변환 후 /api/mobile/classify-defects 를 사용하세요.
export async function POST() {
  return NextResponse.json(
    { error: '음성 파일 직접 분류는 지원되지 않습니다. 텍스트로 변환 후 /api/mobile/classify-defects 를 사용하세요.' },
    { status: 400 }
  )
}
