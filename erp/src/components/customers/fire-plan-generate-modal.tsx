'use client'

import { useState, useTransition } from 'react'
import { X, Loader2, FileOutput } from 'lucide-react'
import { generateFirePlanAction } from '@/app/(dashboard)/customers/fire-plan-actions'
import { DateInput } from '@/components/ui/date-input'
import type { FirePlanGenData, BrigadeRow, EvacRow } from '@/lib/fire-plan-template'

/** 서식 1.4 시설 목록 — 서버 템플릿과 동일 구성 (클라이언트 표시용 복제) */
const FACILITY_GROUPS: Array<{ category: string; items: string[] }> = [
  { category: '소화설비', items: ['소화기구 및 자동소화장치', '옥내소화전설비', '옥외소화전설비', '스프링클러설비', '간이스프링클러설비', '화재조기진압용 스프링클러설비', '물분무소화설비', '미분무소화설비', '포소화설비', '이산화탄소소화설비', '할론소화설비', '할로겐화합물 및 불활성기체소화설비', '분말소화설비', '강화액소화설비', '고체에어로졸소화설비'] },
  { category: '경보설비', items: ['단독경보형감지기', '비상경보설비', '자동화재탐지설비 및 시각경보기', '화재알림설비', '비상방송설비', '통합감시시설', '자동화재속보설비', '누전경보기', '가스누설경보기'] },
  { category: '피난구조설비', items: ['피난기구', '인명구조기구', '피난유도선', '유도등', '비상조명등', '유도표지', '휴대용비상조명등'] },
  { category: '소화용수설비', items: ['상수도소화용수설비', '소화수조 및 저수조'] },
  { category: '소화활동설비', items: ['거실제연설비', '부속실 등 제연설비', '비상콘센트설비', '연결송수관설비', '무선통신보조설비', '연결살수설비', '연소방지설비'] },
]

const inputCls = 'w-full h-8 rounded-lg border border-[#d0ccf5] bg-white px-2 text-xs outline-none focus:border-[#7b68ee]'
const labelCls = 'text-[11px] font-medium text-[#514b81]'

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-0.5"><label className={labelCls}>{label}</label>{children}</div>
}

export function FirePlanGenerateModal({ customerId, initial, onClose, onDone }: {
  customerId: string
  initial: FirePlanGenData
  onClose: () => void
  onDone: () => void
}) {
  const [d, setD] = useState<FirePlanGenData>(initial)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const set = <K extends keyof FirePlanGenData>(k: K, val: FirePlanGenData[K]) => setD(prev => ({ ...prev, [k]: val }))

  function toggleFacility(item: string) {
    setD(prev => ({
      ...prev,
      facilities: prev.facilities.includes(item)
        ? prev.facilities.filter(f => f !== item)
        : [...prev.facilities, item],
    }))
  }
  function setBrigade(i: number, k: keyof BrigadeRow, val: string) {
    setD(prev => { const rows = [...prev.brigade]; rows[i] = { ...rows[i], [k]: val }; return { ...prev, brigade: rows } })
  }
  function setEvac(i: number, k: keyof EvacRow, val: string) {
    setD(prev => { const rows = [...prev.evacRoutes]; rows[i] = { ...rows[i], [k]: val }; return { ...prev, evacRoutes: rows } })
  }

  function handleGenerate() {
    setError('')
    startTransition(async () => {
      const res = await generateFirePlanAction(customerId, d)
      if (res.error) { setError(res.error); return }
      onDone()
    })
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e0ddf5] shrink-0">
          <div className="flex items-center gap-2">
            <FileOutput className="size-4 text-[#7b68ee]" />
            <p className="text-sm font-semibold text-[#090c1d]">소방계획서 표준양식 생성</p>
            <p className="text-[11px] text-[#b0acd6]">고객·건물·시설 데이터가 자동 입력됩니다 — 확인·보완 후 생성</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-[#f5f4ff] rounded-lg"><X className="size-4 text-[#514b81]" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 기본 */}
          <section>
            <p className="text-xs font-bold text-[#7b68ee] mb-2">기본 정보 · 개정이력</p>
            <div className="grid grid-cols-4 gap-2">
              <F label="연도"><input type="number" value={d.year} onChange={e => set('year', parseInt(e.target.value || '0', 10))} className={inputCls} /></F>
              <F label="작성일"><DateInput value={d.revisionDate} onChange={e => set('revisionDate', e.target.value)} className={inputCls} /></F>
              <div className="col-span-2"><F label="개정 내용"><input value={d.revisionNote} onChange={e => set('revisionNote', e.target.value)} className={inputCls} /></F></div>
            </div>
          </section>

          {/* 서식 1.1 */}
          <section>
            <p className="text-xs font-bold text-[#7b68ee] mb-2">서식 1.1 — 건축물 일반현황</p>
            <div className="grid grid-cols-3 gap-2">
              <F label="명칭"><input value={d.buildingName} onChange={e => set('buildingName', e.target.value)} className={inputCls} /></F>
              <div className="col-span-2"><F label="도로명주소"><input value={d.address} onChange={e => set('address', e.target.value)} className={inputCls} /></F></div>
              <F label="대상물 급수">
                <select value={d.grade} onChange={e => set('grade', e.target.value)} className={inputCls}>
                  {['특급', '1급', '2급', '3급'].map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </F>
              <F label="주용도"><input value={d.purpose} onChange={e => set('purpose', e.target.value)} className={inputCls} /></F>
              <F label="사용승인일"><DateInput value={d.useApprovalDate} onChange={e => set('useApprovalDate', e.target.value)} className={inputCls} /></F>
              <F label="연면적(㎡)"><input value={d.totalArea} onChange={e => set('totalArea', e.target.value)} className={inputCls} /></F>
              <F label="건축면적(㎡)"><input value={d.buildingArea} onChange={e => set('buildingArea', e.target.value)} className={inputCls} /></F>
              <F label="층수"><input value={d.floors} onChange={e => set('floors', e.target.value)} className={inputCls} /></F>
              <F label="높이(m)"><input value={d.height} onChange={e => set('height', e.target.value)} className={inputCls} /></F>
              <F label="구조"><input value={d.structure} onChange={e => set('structure', e.target.value)} placeholder="예: 철근콘크리트" className={inputCls} /></F>
              <F label="지붕"><input value={d.roof} onChange={e => set('roof', e.target.value)} className={inputCls} /></F>
              <F label="수신기 위치"><input value={d.receiverLocation} onChange={e => set('receiverLocation', e.target.value)} placeholder="예: 1층 관리실" className={inputCls} /></F>
              <F label="대표자(책임자)"><input value={d.ownerName} onChange={e => set('ownerName', e.target.value)} className={inputCls} /></F>
              <F label="대표자 연락처"><input value={d.ownerPhone} onChange={e => set('ownerPhone', e.target.value)} className={inputCls} /></F>
              <F label="소방안전관리자"><input value={d.managerName} onChange={e => set('managerName', e.target.value)} className={inputCls} /></F>
              <F label="관리자 연락처"><input value={d.managerPhone} onChange={e => set('managerPhone', e.target.value)} className={inputCls} /></F>
              <F label="관리자 선임일자"><DateInput value={d.managerSelectedAt} onChange={e => set('managerSelectedAt', e.target.value)} className={inputCls} /></F>
            </div>
          </section>

          {/* 서식 1.3 / 1.10 */}
          <section>
            <p className="text-xs font-bold text-[#7b68ee] mb-2">서식 1.3 · 1.10 — 관할서 / 자체점검</p>
            <div className="grid grid-cols-4 gap-2">
              <F label="관할소방서"><input value={d.fireStation} onChange={e => set('fireStation', e.target.value)} className={inputCls} /></F>
              <F label="최단거리(km)"><input value={d.stationDistance} onChange={e => set('stationDistance', e.target.value)} className={inputCls} /></F>
              <F label="도착시간(분)"><input value={d.stationEta} onChange={e => set('stationEta', e.target.value)} className={inputCls} /></F>
              <F label="훈련·교육 월">
                <select value={d.trainingMonth} onChange={e => set('trainingMonth', parseInt(e.target.value, 10))} className={inputCls}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}월</option>)}
                </select>
              </F>
              <div className="col-span-2"><F label="작동점검 시기"><input value={d.operationMonth} onChange={e => set('operationMonth', e.target.value)} className={inputCls} /></F></div>
              <div className="col-span-2"><F label="종합점검 시기 (종합 대상만)"><input value={d.comprehensiveMonth} onChange={e => set('comprehensiveMonth', e.target.value)} className={inputCls} /></F></div>
            </div>
          </section>

          {/* 서식 1.4 */}
          <section>
            <p className="text-xs font-bold text-[#7b68ee] mb-2">서식 1.4 — 소방시설 현황 <span className="text-[10px] text-[#b0acd6] font-normal">(건물 시설현황에서 자동 체크됨)</span></p>
            <div className="space-y-2">
              {FACILITY_GROUPS.map(g => (
                <div key={g.category}>
                  <p className="text-[11px] font-semibold text-[#514b81] mb-1">{g.category}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {g.items.map(item => (
                      <label key={item} className="flex items-center gap-1 text-[11px] text-[#292d34] cursor-pointer">
                        <input type="checkbox" checked={d.facilities.includes(item)} onChange={() => toggleFacility(item)} className="accent-[#7b68ee]" />
                        {item}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 제2장 자위소방대 */}
          <section>
            <p className="text-xs font-bold text-[#7b68ee] mb-2">제2장 — 자위소방대 편성표 (Type-Ⅲ)</p>
            <div className="space-y-1.5">
              {d.brigade.map((b, i) => (
                <div key={i} className="grid grid-cols-[110px_90px_1fr_120px_24px] gap-1.5 items-center">
                  <input value={b.team} onChange={e => setBrigade(i, 'team', e.target.value)} placeholder="구분" className={inputCls} />
                  <input value={b.name} onChange={e => setBrigade(i, 'name', e.target.value)} placeholder="성명" className={inputCls} />
                  <input value={b.duty} onChange={e => setBrigade(i, 'duty', e.target.value)} placeholder="개별임무" className={inputCls} />
                  <input value={b.phone} onChange={e => setBrigade(i, 'phone', e.target.value)} placeholder="연락처" className={inputCls} />
                  <button onClick={() => set('brigade', d.brigade.filter((_, j) => j !== i))} className="text-[#b0acd6] hover:text-red-500 text-xs">✕</button>
                </div>
              ))}
              <button onClick={() => set('brigade', [...d.brigade, { team: '', name: '', duty: '', phone: '' }])}
                className="text-[11px] text-[#7b68ee] hover:underline">+ 행 추가</button>
            </div>
          </section>

          {/* 제3장 피난계획 */}
          <section>
            <p className="text-xs font-bold text-[#7b68ee] mb-2">제3장 — 피난경로 · 집결지</p>
            <div className="space-y-1.5">
              {d.evacRoutes.map((r, i) => (
                <div key={i} className="grid grid-cols-[90px_1fr_110px_110px_24px] gap-1.5 items-center">
                  <input value={r.floor} onChange={e => setEvac(i, 'floor', e.target.value)} placeholder="층별" className={inputCls} />
                  <input value={r.route} onChange={e => setEvac(i, 'route', e.target.value)} placeholder="피난경로" className={inputCls} />
                  <input value={r.guide} onChange={e => setEvac(i, 'guide', e.target.value)} placeholder="피난유도자" className={inputCls} />
                  <input value={r.equip} onChange={e => setEvac(i, 'equip', e.target.value)} placeholder="피난구조설비" className={inputCls} />
                  <button onClick={() => set('evacRoutes', d.evacRoutes.filter((_, j) => j !== i))} className="text-[#b0acd6] hover:text-red-500 text-xs">✕</button>
                </div>
              ))}
              <button onClick={() => set('evacRoutes', [...d.evacRoutes, { floor: '', route: '', guide: '', equip: '' }])}
                className="text-[11px] text-[#7b68ee] hover:underline">+ 행 추가</button>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <F label="집결지"><input value={d.assembly} onChange={e => set('assembly', e.target.value)} className={inputCls} /></F>
                <F label="화재 시 피난유도 방법"><input value={d.evacNote} onChange={e => set('evacNote', e.target.value)} className={inputCls} /></F>
              </div>
            </div>
          </section>

          {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[#e0ddf5] flex gap-2 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-[#c8c4d0] rounded-lg text-[#514b81] hover:bg-[#fafafa]">취소</button>
          <button onClick={handleGenerate} disabled={isPending}
            className="flex-1 py-2.5 text-sm bg-[#7b68ee] text-white rounded-lg font-medium hover:bg-[#6647f0] disabled:opacity-50 flex items-center justify-center gap-2">
            {isPending ? <><Loader2 className="size-4 animate-spin" /> PDF 생성 중…</> : 'PDF 생성 — 보관함에 저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
