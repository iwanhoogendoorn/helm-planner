import { describe, expect, it } from 'vitest';
import { setup, dailyPath, keyOf, TODAY } from './fixture';
import { taskContext } from '../../src/data/taskContext';

describe('taskContext (CD-10)', () => {
  it('names the project and phase, the task it follows, its parent and the projects linking to it', async () => {
    const { index } = await setup({
      '02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md': '---\ntitle: Kitchen Remodel\ntype: project\nstatus: planned\npriority: medium\nid: prj-kitchen\n---\n\n# Kitchen Remodel\n\n## Related tasks\n\n- tsk-0001\n\n## Tasks\n\n- [ ] Get three quotes\n',
    });
    const draft = index.task('tsk-0001')!;
    expect(taskContext(index, draft)).toEqual([
      { kind: 'project', text: 'Oracle Book Writing', title: 'Project: Oracle Book Writing › Outline', ref: 'prj-book' },
      { kind: 'related', text: 'Kitchen Remodel', title: 'Linked from project: Kitchen Remodel', ref: 'prj-kitchen' },
    ]);
    const review = index.task(keyOf(index, 'Review with editor'))!;
    expect(taskContext(index, review).find((c) => c.kind === 'follows')).toEqual({ kind: 'follows', text: 'Draft chapter list', title: 'Follow-up of: Draft chapter list', ref: 'tsk-0001' });
    const collect = index.task(keyOf(index, 'Collect diagrams'))!;
    expect(taskContext(index, collect).find((c) => c.kind === 'parent')).toEqual({ kind: 'parent', text: 'Draft chapter list', title: 'Subtask of: Draft chapter list', ref: 'tsk-0001' });
  });

  it('a mirror on a day says what its source belongs to', async () => {
    const { index } = await setup({ [dailyPath(TODAY)]: '# Day planner\n\n### Anytime\n- [ ] Chapter 2 🆔 tsk-0002 🔗 [[Oracle Book Writing]]\n' });
    const mirror = index.mirrorsOf('tsk-0002')[0]!;
    expect(taskContext(index, mirror)).toEqual([{ kind: 'project', text: 'Oracle Book Writing', title: 'Project: Oracle Book Writing › Writing', ref: 'prj-book' }]);
  });

  it('an inbox line belongs to nothing', async () => {
    const { index } = await setup();
    expect(taskContext(index, index.task(keyOf(index, 'Call the plumber'))!)).toEqual([]);
  });
});
