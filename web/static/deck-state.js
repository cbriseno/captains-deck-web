'use strict';
// Small, deterministic reconciliation rules shared with the Node regression suite.
window.DeckState = Object.freeze({
  reconcileProjects(nodes, keyOf) {
    for (const task of nodes) {
      if (task.kind !== 'task' || task.parent) continue;
      const project = task.card?.project || task.card?.flow?.project || task.flow?.project || task.project;
      if (!project?.id) continue;
      const ownerId = project.id.startsWith('project:') ? project.id : 'project:' + project.id;
      let parent = nodes.find(row => row.home === task.home && row.owner_id === ownerId && row.kind === 'project');
      if (!parent && project.label) {
        parent = {id:keyOf(task.home,ownerId),owner_id:ownerId,home:task.home,title:project.label,
          color_key:project.id,kind:'project',state:'unknown',priority:null,parent:''};
        nodes.push(parent);
      }
      if (parent) task.parent = parent.id;
    }
    return nodes;
  },
  identity(x) { return x?.alias || x?.raw?.alias || x?.card?.alias || x?.owner_id || (x?.task ? 'task:' + x.task : '') || x?.raw?.key || x?.color_key || x?.id || ''; },
  completionNote(percent, state) { return percent === 100 && state !== 'done'; }
});
