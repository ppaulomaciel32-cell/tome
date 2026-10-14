(() => {
  'use strict';
  const id=window.TNN_CONFIG?.ga4Id || '';let started=false;
  function load(){
    if(started || window.TNNConsent?.get()!=='all' || !/^G-[A-Z0-9]{6,20}$/.test(id) || location.pathname.startsWith('/admin'))return;
    started=true;window.dataLayer=window.dataLayer || [];
    function tag(){window.dataLayer.push(arguments);}
    window.gtag=tag;
    tag('consent','default',{analytics_storage:'granted',ad_storage:'granted',ad_user_data:'denied',ad_personalization:'denied'});
    tag('js',new Date());
    tag('config',id,{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false});
    const url=new URL(location.href);url.hash='';url.search='';
    const raw=new URL(location.href);
    // Não envia busca, e-mail, ID de rascunho ou query arbitrária.
    for(const key of ['utm_source','utm_medium','utm_campaign']){
      const value=raw.searchParams.get(key);if(value && /^[a-zA-Z0-9_-]{1,80}$/.test(value))url.searchParams.set(key,value);
    }
    let ref='';try{ref=new URL(document.referrer).origin+'/';}catch{}
    tag('event','page_view',{page_location:url.href,page_referrer:ref,page_title:document.title,
      localidade:document.documentElement.dataset.localidade || 'regiao'});
    const script=document.createElement('script');script.id='tnn-ga4';script.async=true;
    script.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(id);document.head.append(script);
  }
  window.addEventListener('tnn:consent',load);load();
})();
