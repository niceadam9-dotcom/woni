#!/usr/bin/env node
/**
 * Claude Code Hook — checklist 자동 동기화
 *
 * 트리거: PostToolUse(TaskUpdate) 이벤트
 *
 * Task subject 형식:
 *   "[3-1] ..."           → erp_goal/checklist.json (기존 ERP 체크리스트)
 *   "[fire:3-1] ..."      → erp_goal/inspection_checklist.json (소방 점검 체크리스트)
 *   "[new:FA-04] ..."     → erp_goal/NEW1.JSON (신규 개발 체크리스트)
 *   "[new:MO-01] ..."     → erp_goal/NEW1.JSON
 *   "[new:HOOK] ..."      → erp_goal/NEW1.JSON (meta 항목, 직접 id로 매칭)
 *   "[fix:FIX-1] ..."     → erp_goal/victory_test_result_fixing.json (테스트 결과 수정 목록)
 *   "[fix:IMP-2] ..."     → erp_goal/victory_test_result_fixing.json
 *
 * TaskUpdate status 매핑:
 *   in_progress → "partial"   (checklist: "in_progress")
 *   completed   → "completed" (checklist: "done")
 */

const fs = require('fs');
const path = require('path');

const BASE = 'f:/AI/ERP/erp_goal';
const FILES = {
  erp:  path.join(BASE, 'checklist.json'),
  fire: path.join(BASE, 'inspection_checklist.json'),
  new1: path.join(BASE, 'NEW1.JSON'),
  v8:   path.join(BASE, 'Victory8.json'),
  v10:  path.join(BASE, 'Victory10.json'),
  fix:  path.join(BASE, 'victory_test_result_fixing.json'),
  add:  path.join(BASE, 'Victory10_add.json'),
};

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) { resolve(''); return; }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 2000);
  });
}

// ── 기존 ERP / 소방 체크리스트 (checklist.json / inspection_checklist.json) ──
function updateChecklist(filePath, itemId, status) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const doc = JSON.parse(raw);

    let updated = false;
    for (const category of doc.checklist) {
      for (const item of category.items) {
        if (item.id === itemId) {
          if (item.status !== status) {
            item.status = status;
            updated = true;
          }
          break;
        }
      }
      if (updated) break;
    }

    if (updated) {
      doc.last_updated = new Date().toISOString().split('T')[0];
      fs.writeFileSync(filePath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      process.stderr.write(
        `[sync-checklist] ${path.basename(filePath)} :: ${itemId} → ${status}\n`
      );
    } else {
      process.stderr.write(
        `[sync-checklist] ${path.basename(filePath)} :: ${itemId} — 항목 없음 또는 이미 동일 상태\n`
      );
    }
  } catch (e) {
    process.stderr.write(`[sync-checklist] error: ${e.message}\n`);
  }
}

// ── NEW1.JSON 업데이트 ──
// itemId: "FA-04", "FA-04-1", "MO-01" 등
// newStatus: "partial" | "completed"
function updateNew1(itemId, newStatus) {
  try {
    const raw = fs.readFileSync(FILES.new1, 'utf8');
    const doc = JSON.parse(raw);

    let updated = false;

    for (const category of doc.categories) {
      for (const item of category.items) {
        // 최상위 item 매칭
        if (item.id === itemId) {
          if (item.status !== newStatus) {
            item.status = newStatus;
            updated = true;
          }
          break;
        }
        // sub_items 매칭
        if (Array.isArray(item.sub_items)) {
          for (const sub of item.sub_items) {
            if (sub.id === itemId) {
              if (sub.status !== newStatus) {
                sub.status = newStatus;
                updated = true;
              }
              break;
            }
          }
        }
        if (updated) break;
      }
      if (updated) break;
    }

    // db_tables_new 매칭 (테이블 id는 table 필드로)
    if (!updated) {
      for (const tbl of (doc.db_tables_new || [])) {
        if (tbl.table === itemId) {
          if (tbl.status !== newStatus) {
            tbl.status = newStatus;
            updated = true;
          }
          break;
        }
      }
    }

    if (updated) {
      doc.meta.updated_at = new Date().toISOString().split('T')[0];
      // summary 재계산
      if (doc.summary) {
        let completed = 0, partial = 0, pending = 0;
        for (const cat of doc.categories) {
          for (const item of cat.items) {
            if (item.status === 'completed') completed++;
            else if (item.status === 'partial') partial++;
            else pending++;
            for (const sub of (item.sub_items || [])) {
              if (sub.status === 'completed') completed++;
              else if (sub.status === 'partial') partial++;
              else pending++;
            }
          }
        }
        doc.summary.completed = completed;
        doc.summary.partial   = partial;
        doc.summary.pending   = pending;
        doc.summary.total_items = completed + partial + pending;
      }
      fs.writeFileSync(FILES.new1, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      process.stderr.write(
        `[sync-checklist] NEW1.JSON :: ${itemId} → ${newStatus}\n`
      );
    } else {
      process.stderr.write(
        `[sync-checklist] NEW1.JSON :: ${itemId} — 항목 없음 또는 이미 동일 상태\n`
      );
    }
  } catch (e) {
    process.stderr.write(`[sync-checklist] NEW1.JSON error: ${e.message}\n`);
  }
}

// ── Victory8.json 업데이트 ──
// itemId: "V8-R01"~"V8-R06" (구현 로드맵), "V8-A01"~"V8-A08" (지역배정 파일)
// newStatus: "진행중" | "완료"
function updateVictory8(itemId, newStatus) {
  try {
    const raw = fs.readFileSync(FILES.v8, 'utf8');
    const doc = JSON.parse(raw);

    let updated = false;

    // implementationRoadmap 검색
    for (const item of (doc.implementationRoadmap || [])) {
      if (item.id === itemId) {
        if (item.status !== newStatus) {
          item.status = newStatus;
          updated = true;
        }
        break;
      }
    }

    // regionalAssignment.files 검색
    if (!updated) {
      for (const item of ((doc.regionalAssignment || {}).files || [])) {
        if (item.id === itemId) {
          if (item.status !== newStatus) {
            item.status = newStatus;
            updated = true;
          }
          break;
        }
      }
    }

    if (updated) {
      fs.writeFileSync(FILES.v8, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      process.stderr.write(
        `[sync-checklist] Victory8.json :: ${itemId} → ${newStatus}\n`
      );
    } else {
      process.stderr.write(
        `[sync-checklist] Victory8.json :: ${itemId} — 항목 없음 또는 이미 동일 상태\n`
      );
    }
  } catch (e) {
    process.stderr.write(`[sync-checklist] Victory8.json error: ${e.message}\n`);
  }
}

// ── Victory10.json 업데이트 ──
// itemId: "P-1"~"P-20" (pending_all)
// newStatus: "in_progress" | "completed"
function updateVictory10(itemId, newStatus) {
  try {
    const raw = fs.readFileSync(FILES.v10, 'utf8');
    const doc = JSON.parse(raw);

    let updated = false;

    for (const item of (doc.pending_all || [])) {
      if (item.id === itemId) {
        if (item.status !== newStatus) {
          item.status = newStatus;
          updated = true;
        }
        break;
      }
    }

    if (updated) {
      doc.date = new Date().toISOString().split('T')[0];
      fs.writeFileSync(FILES.v10, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      process.stderr.write(
        `[sync-checklist] Victory10.json :: ${itemId} → ${newStatus}\n`
      );
    } else {
      process.stderr.write(
        `[sync-checklist] Victory10.json :: ${itemId} — 항목 없음 또는 이미 동일 상태\n`
      );
    }
  } catch (e) {
    process.stderr.write(`[sync-checklist] Victory10.json error: ${e.message}\n`);
  }
}

// ── victory_test_result_fixing.json 업데이트 ──
// itemId: "FIX-1"~"FIX-10" (critical_bugs/functional_bugs), "IMP-1"~"IMP-9" (improvements)
// newStatus: "in_progress" | "completed"
function updateFixing(itemId, newStatus) {
  try {
    const raw = fs.readFileSync(FILES.fix, 'utf8');
    const doc = JSON.parse(raw);

    let updated = false;
    for (const listName of ['critical_bugs', 'functional_bugs', 'improvements']) {
      for (const item of (doc[listName] || [])) {
        if (item.id === itemId) {
          if (item.status !== newStatus) {
            item.status = newStatus;
            updated = true;
          }
          break;
        }
      }
      if (updated) break;
    }

    if (updated) {
      doc.date = new Date().toISOString().split('T')[0];
      // summary 재계산
      const all = ['critical_bugs', 'functional_bugs', 'improvements']
        .flatMap(k => doc[k] || []);
      doc.summary = {
        total: all.length,
        completed:   all.filter(i => i.status === 'completed').length,
        in_progress: all.filter(i => i.status === 'in_progress').length,
        pending:     all.filter(i => i.status === 'pending').length,
      };
      fs.writeFileSync(FILES.fix, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      process.stderr.write(
        `[sync-checklist] victory_test_result_fixing.json :: ${itemId} → ${newStatus}\n`
      );
    } else {
      process.stderr.write(
        `[sync-checklist] victory_test_result_fixing.json :: ${itemId} — 항목 없음 또는 이미 동일 상태\n`
      );
    }
  } catch (e) {
    process.stderr.write(`[sync-checklist] victory_test_result_fixing.json error: ${e.message}\n`);
  }
}

// ── Victory10_add.json 업데이트 ──
// itemId: "ADD-1" ~ (items + follow_up 배열)
function updateAdd(itemId, newStatus) {
  try {
    const raw = fs.readFileSync(FILES.add, 'utf8');
    const doc = JSON.parse(raw);

    let updated = false;
    for (const listName of ['items', 'follow_up']) {
      for (const item of (doc[listName] || [])) {
        if (item.id === itemId) {
          if (item.status !== newStatus) {
            item.status = newStatus;
            if (newStatus === 'completed') item.resolved_date = new Date().toISOString().split('T')[0];
            updated = true;
          }
          break;
        }
      }
      if (updated) break;
    }

    if (updated) {
      const all = ['items', 'follow_up'].flatMap(k => doc[k] || []);
      doc.summary = {
        total: all.length,
        completed:   all.filter(i => i.status === 'completed').length,
        in_progress: all.filter(i => i.status === 'in_progress').length,
        pending:     all.filter(i => i.status === 'pending').length,
      };
      doc.date = new Date().toISOString().split('T')[0];
      fs.writeFileSync(FILES.add, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      process.stderr.write(`[sync-checklist] Victory10_add.json :: ${itemId} → ${newStatus}\n`);
    } else {
      process.stderr.write(`[sync-checklist] Victory10_add.json :: ${itemId} — 항목 없음 또는 이미 동일 상태\n`);
    }
  } catch (e) {
    process.stderr.write(`[sync-checklist] Victory10_add.json error: ${e.message}\n`);
  }
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }

  if (payload.hook_event_name !== 'PostToolUse') return;
  if (payload.tool_name !== 'TaskUpdate') return;

  const input    = payload.tool_input    || {};
  const response = payload.tool_response || {};

  const subject =
    response.subject || response.title ||
    input.subject    || input.title    || '';

  const newTaskStatus = input.status;

  // ── [add:ADD-1] → Victory10_add.json ──
  const addMatch = subject.match(/^\[add:(ADD-\d+)\]/i);
  if (addMatch) {
    const itemId = addMatch[1].toUpperCase();
    if (newTaskStatus === 'completed')   updateAdd(itemId, 'completed');
    if (newTaskStatus === 'in_progress') updateAdd(itemId, 'in_progress');
    return;
  }

  // ── [fix:FIX-1] / [fix:IMP-2] → victory_test_result_fixing.json ──
  const fixMatch = subject.match(/^\[fix:((?:FIX|IMP|NEW)-\d+)\]/i);
  if (fixMatch) {
    const itemId = fixMatch[1].toUpperCase();
    if (newTaskStatus === 'completed')   updateFixing(itemId, 'completed');
    if (newTaskStatus === 'in_progress') updateFixing(itemId, 'in_progress');
    return;
  }

  // ── [v10:P-1] ~ [v10:P-20] → Victory10.json ──
  const v10Match = subject.match(/^\[v10:(P-\d+)\]/i);
  if (v10Match) {
    const itemId = v10Match[1].toUpperCase();
    if (newTaskStatus === 'completed')   updateVictory10(itemId, 'completed');
    if (newTaskStatus === 'in_progress') updateVictory10(itemId, 'in_progress');
    return;
  }

  // ── [v8:V8-R01] / [v8:V8-A04] → Victory8.json ──
  const v8Match = subject.match(/^\[v8:(V8-[A-Z0-9]+)\]/i);
  if (v8Match) {
    const itemId = v8Match[1].toUpperCase();
    if (newTaskStatus === 'completed')   updateVictory8(itemId, '완료');
    if (newTaskStatus === 'in_progress') updateVictory8(itemId, '진행중');
    return;
  }

  // ── [new:FA-04] / [new:MO-01] / [new:HOOK] → NEW1.JSON ──
  const newMatch = subject.match(/^\[new:([A-Z0-9_-]+)\]/i);
  if (newMatch) {
    const itemId = newMatch[1].toUpperCase();
    if (newTaskStatus === 'completed')   updateNew1(itemId, 'completed');
    if (newTaskStatus === 'in_progress') updateNew1(itemId, 'partial');
    return;
  }

  // ── [fire:3-1] → inspection_checklist.json ──
  const fireMatch = subject.match(/^\[fire:(\d+-\d+)\]/i);
  if (fireMatch) {
    const checklistId = fireMatch[1];
    if (newTaskStatus === 'completed')   updateChecklist(FILES.fire, checklistId, 'done');
    if (newTaskStatus === 'in_progress') updateChecklist(FILES.fire, checklistId, 'in_progress');
    return;
  }

  // ── [3-1] → checklist.json (기존 ERP) ──
  const erpMatch = subject.match(/^\[(\d+-\d+)\]/);
  if (erpMatch) {
    const checklistId = erpMatch[1];
    if (newTaskStatus === 'completed')   updateChecklist(FILES.erp, checklistId, 'done');
    if (newTaskStatus === 'in_progress') updateChecklist(FILES.erp, checklistId, 'in_progress');
  }
}

main();
