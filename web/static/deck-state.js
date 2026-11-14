'use strict';
// Small, deterministic reconciliation rules shared with the Node regression suite.
window.DeckState = Object.freeze({
  reconcileProjects(nodes, keyOf, t = (text, values) => text.replace('{project}', values.project)) {
    for (const task of nodes) {
      if (task.kind !== 'task' || task.parent && nodes.some(row => row.id === task.parent)) continue;
      const declared = task.card?.project || task.card?.flow?.project || task.flow?.project || task.project || task.raw?.project || task.raw?.repository_project;
      const project = typeof declared === 'string' && declared.startsWith('project:') ? {id:declared,label:declared.slice(8)} : declared;
      if (!project?.id) continue;
      const ownerId = project.id.startsWith('project:') ? project.id : 'project:' + project.id;
      let parent = nodes.find(row => row.home === task.home && row.owner_id === ownerId && row.kind === 'project');
      if (!parent && project.label) {
        parent = {id:keyOf(task.home,ownerId),owner_id:ownerId,home:task.home,title:t('Unresolved project: {project}', {project:project.label}),
          color_key:project.id,kind:'project',state:'unknown',priority:null,parent:''};
        nodes.push(parent);
      }
      if (parent) task.parent = parent.id;
    }
    return nodes;
  },
  displayState(x) {
    if (x.state !== 'done' && ['finished','missing'].includes(x.card?.activity?.kind)) return 'waiting';
    if (x.state === 'ready' && x.raw?.backlog_state === 'in_flight') return 'unknown';
    return x.state === 'active' && x.card?.activity?.kind === 'paused' ? 'paused' : x.state;
  },
  identity(x) { return x?.alias || x?.raw?.alias || x?.card?.alias || x?.owner_id || (x?.task ? 'task:' + x.task : '') || x?.raw?.key || x?.color_key || x?.id || ''; },
  completionNote(percent, state) { return percent === 100 && state !== 'done'; }
});
