'use client'

import { useState, useMemo } from 'react'

type RegionEntry = {
  region_si: string | null
  region_myeon: string | null
  region_ri: string | null
}

type Props = {
  regionData: RegionEntry[]
  currentSi: string
  currentMyeon: string
  currentRi: string
}

const selectCls = 'h-9 rounded-lg border border-[#d0ccf5] bg-white px-3 text-sm text-[#090c1d] outline-none focus:border-[#7b68ee] transition'

export function CustomerRegionFilterClient({ regionData, currentSi, currentMyeon, currentRi }: Props) {
  const [si, setSi] = useState(currentSi)
  const [myeon, setMyeon] = useState(currentMyeon)
  const [ri, setRi] = useState(currentRi)

  const siOptions = useMemo(() =>
    [...new Set(regionData.map(r => r.region_si).filter((v): v is string => v !== null))].sort()
  , [regionData])

  const myeonOptions = useMemo(() =>
    si
      ? [...new Set(
          regionData
            .filter(r => r.region_si === si)
            .map(r => r.region_myeon)
            .filter((v): v is string => v !== null)
        )].sort()
      : []
  , [regionData, si])

  const riOptions = useMemo(() =>
    si && myeon
      ? [...new Set(
          regionData
            .filter(r => r.region_si === si && r.region_myeon === myeon)
            .map(r => r.region_ri)
            .filter((v): v is string => v !== null)
        )].sort()
      : []
  , [regionData, si, myeon])

  function handleSiChange(val: string) {
    setSi(val)
    setMyeon('')
    setRi('')
  }

  function handleMyeonChange(val: string) {
    setMyeon(val)
    setRi('')
  }

  if (siOptions.length === 0) return null

  return (
    <>
      {/* 시/군/구 */}
      <select
        name="region_si"
        value={si}
        onChange={e => handleSiChange(e.target.value)}
        className={selectCls}
      >
        <option value="">전체 지역</option>
        {siOptions.map(s => <option key={s} value={s}>{s}</option>)}
      </select>

      {/* 읍/면/동 — si 선택 시 표시 */}
      {si && (
        <select
          name="region_myeon"
          value={myeon}
          onChange={e => handleMyeonChange(e.target.value)}
          className={selectCls}
        >
          <option value="">전체 읍/면/동</option>
          {myeonOptions.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      )}

      {/* 리/동 — myeon 선택 시 표시 */}
      {si && myeon && (
        <select
          name="region_ri"
          value={ri}
          onChange={e => setRi(e.target.value)}
          className={selectCls}
        >
          <option value="">전체 리/동</option>
          {riOptions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      )}
    </>
  )
}
