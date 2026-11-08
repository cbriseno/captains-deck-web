/* Answer files and corrections use Firstmate's existing guarded intake. */
'use strict';
window.createAnswerTools = ({t,node,button,api,state,syncSubmit}) => {
  const accept='.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.csv,.json,.zip';
  let dropTarget=null;
  const blocked=()=>window.DeckAnonymize?.enabled;
  function enlarge(file) {
    if(blocked())return;
    const dialog=node('dialog','answer-lightbox'),image=node('img');image.src=file.url;image.alt=file.name;
    dialog.append(image);dialog.setAttribute('aria-label',t('Enlarged attachment'));
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dialog.close();}});
    dialog.addEventListener('click',event=>{event.stopPropagation();dialog.close();});dialog.addEventListener('close',()=>dialog.remove());
    document.body.append(dialog);dialog.showModal();
  }
  function files(items,remove) {
    const list=node('div','answer-files');
    items.forEach((file,index)=>{
      const chip=node('div','answer-file'),isImage=file.type?.startsWith('image/');
      if(isImage){const view=button('',()=>enlarge(file),'answer-image');const img=node('img');img.src=file.url;img.alt=file.name;view.setAttribute('aria-label',t('Enlarge {name}',{name:file.name}));view.append(img);chip.append(view);}
      else {const link=node('a','answer-file-link',file.name);link.href=file.url;link.download=file.name;chip.append(link);}
      chip.append(node('span','meta',isImage?file.name:''),file.size?node('small','meta',t('{count} KB',{count:Math.max(1,Math.ceil(file.size/1024))})):node('span'));
      if(remove){const close=button('✕',()=>remove(index),'answer-remove');close.setAttribute('aria-label',t('Remove {name}',{name:file.name}));chip.append(close);}
      list.append(chip);
    });return list;
  }
  function composer(container,uploadPath,items,changed,active=()=>true) {
    const picker=node('input');picker.type='file';picker.multiple=true;picker.accept=accept;picker.hidden=true;
    const attach=button('📎',()=>picker.click(),'answer-attach');attach.setAttribute('aria-label',t('Attach files'));
    const hint=node('small','meta',t('Paste a screenshot or drop files here · up to 8 files, 5 MB each'));
    const list=node('div'),status=node('p','notice');status.hidden=true;status.setAttribute('role','status');
    const draw=()=>{list.replaceChildren(files(items,index=>{if(blocked()||!active())return;items.splice(index,1);draw();changed();}));};
    let uploading=false;
    async function add(selected) {
      if(blocked()||uploading||!active())return;
      status.hidden=false;
      if(items.length+selected.length>8){status.textContent=t('Use at most eight attachments.');return;}
      uploading=true;attach.disabled=true;container.dataset.uploading='true';syncSubmit();
      try{for(const file of selected){
        if(!file.size||file.size>5*1024*1024)throw new Error(t('Each attachment must be between 1 byte and 5 MB.'));
        status.textContent=t('Uploading…');
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});
        const saved=await api(uploadPath,{name:file.name,data});items.push(saved);draw();changed();
      }status.textContent='';}catch(error){status.textContent=error.message;}finally{uploading=false;attach.disabled=false;delete container.dataset.uploading;status.hidden=!status.textContent;changed();syncSubmit();}
    }
    picker.addEventListener('change',()=>{add([...picker.files]);picker.value='';});
    container.addEventListener('paste',event=>{const selected=[...(event.clipboardData?.files||[])];if(selected.length){event.preventDefault();add(selected);}});
    const field=container.querySelector('.answer-label'),send=container.querySelector('#answer-submit')||container.querySelector('.answer-send');
    if(field&&send){const row=node('div','answer-compose');row.append(attach,field,send,picker);container.prepend(row);container.append(hint,list,status);}
    else container.append(attach,picker,hint,list,status);
    draw();
    dropTarget={container,add,active};
    return {items};
  }
  document.addEventListener('dragover',event=>{if(dropTarget?.active()&&event.dataTransfer?.types.includes('Files')&&event.target.closest('#detail,.answer-editor,.own-words')){event.preventDefault();dropTarget.container.classList.add('answer-dragover');}});
  document.addEventListener('dragleave',()=>dropTarget?.container.classList.remove('answer-dragover'));
  document.addEventListener('drop',event=>{if(dropTarget?.active()&&event.dataTransfer?.files.length&&event.target.closest('#detail,.answer-editor,.own-words')){event.preventDefault();dropTarget.container.classList.remove('answer-dragover');dropTarget.add([...event.dataTransfer.files]);}});
  function dropCard(card,key,open) {
    card.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();event.stopPropagation();card.classList.add('answer-dragover');}});
    card.addEventListener('dragleave',()=>card.classList.remove('answer-dragover'));
    card.addEventListener('drop',async event=>{
      const selected=[...(event.dataTransfer?.files||[])];if(!selected.length)return;
      event.preventDefault();event.stopPropagation();card.classList.remove('answer-dragover');if(blocked())return;
      if(state.modal?.key!==key||state.modal?.type!=='call')await open();
      if(dropTarget?.active())dropTarget.add(selected);
    });
  }
  function correction(answer,home,host) {
    if(blocked()||host.querySelector('.answer-editor'))return;
    const editor=node('div','answer-editor'),note=node('textarea');note.rows=3;note.value=answer.value||answer.text||'';note.setAttribute('aria-label',t('Your correction'));
    const uploads=[],status=node('p','notice'),send=button(t('Send correction'),()=>{
      if(blocked()||editor.dataset.uploading)return;
      if(!note.value.trim()&&!uploads.length)return;
      const body={note:note.value,attachments:uploads.map(f=>f.id),identity:answer.identity,request_id:crypto.randomUUID().replaceAll('-','')};
      send.disabled=true;note.disabled=true;attachArea.inert=true;
      let remaining=10;
      const undo=button(t('Undo'),()=>{clearInterval(timer);send.disabled=false;note.disabled=false;attachArea.inert=false;status.replaceChildren();},'answer-edit');
      const label=node('span');status.replaceChildren(label,undo);
      const update=()=>label.textContent=t('Sending correction in {count} s',{count:remaining})+' ';update();
      const timer=setInterval(async()=>{
        remaining--;update();if(remaining)return;clearInterval(timer);undo.remove();status.textContent=t('Sending…');
        try{const receipt=await api(`api/answers/${home}/${answer.task_id}/correct`,body);status.textContent=t(receipt.message);if(receipt.saved){editor.remove();host.replaceChildren(await panel(home,answer.task_id));}else status.append(button(t('See answer status'),async()=>{const data=await api('api/receipts');const saved=data.receipts.find(r=>r.request_id===body.request_id);if(saved)status.textContent=t(saved.message);},'answer-edit'));}
        catch(error){status.textContent=error.message;status.append(button(t('See answer status'),async()=>{const data=await api('api/receipts');const saved=data.receipts.find(r=>r.request_id===body.request_id);if(saved)status.textContent=t(saved.message);},'answer-edit'));}
      },1000);
    },'primary answer-edit');
    const attachArea=node('div');attachArea.append(note);composer(attachArea,`api/answers/${home}/${answer.task_id}/upload`,uploads,()=>{},()=>editor.isConnected&&!send.disabled);
    editor.append(node('p','notice',t('This sends a correction to Firstmate. Work already applied stays applied.')),attachArea,send,status);host.append(editor);note.focus();
  }
  async function panel(home,task,taskState,chat) {
    const section=node('section','recorded-answers');
    try{const {answers}=await api(`api/answers/${home}/${task}`);
      for(const answer of answers){const entry=node('div','recorded-answer');entry.append(node('h4','',t(answer.correction?'Correction':'Your answer')),node('p','answer-text',answer.value||answer.text||''),files(answer.files||[]));
        if(answer.can_correct){if(answer.chat_required||taskState==='active'){const url=chat||state.board?.columns.flatMap(c=>c.cards).find(c=>c.home===home&&c.task===answer.origin)?.herdr_url;if(url){const link=node('a','',t('Change answer in chat'));link.href=url;link.target='_blank';link.rel='noopener';entry.append(link);}else entry.append(node('p','notice',t('Use the task chat to change this answer.')));}else entry.append(button(t('Change answer'),()=>correction(answer,home,entry),'answer-edit'));}
        section.append(entry);
      }
    }catch{/* An unavailable owner never invents a saved answer. */}
    return section;
  }
  function summary(x,open) {
    const answers=x.raw?.recorded_answers||[];
    if(!answers.length)return null;
    const section=node('div','answer-summary');
    for(const answer of answers){section.append(node('small','',t('Your answer')),node('p','answer-text',answer.value||answer.text||''),files((answer.attachments||[]).map((file,index)=>({name:file.name,type:/\.(png|jpe?g|gif|webp)$/i.test(file.name)?'image/preview':'application/octet-stream',url:`/api/answers/${x.home}/${answer.task_id}/file/${index}`}))));}
    if(open)section.append(button(t(x.state==='active'?'Change answer in chat':'Change answer'),async()=>{if(blocked())return;await open();document.querySelector('#detail-content .answer-edit')?.click();},'answer-edit'));
    return section;
  }
  return {composer,files,panel,summary,dropCard};
};
