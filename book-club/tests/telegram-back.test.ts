// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { registerBack } from '../src/telegram';
it('кнопка Telegram сначала закрывает диалог, затем возвращает на страницу и скрывается на главной',()=>{
 let press=()=>{};
 const button={show:vi.fn(),hide:vi.fn(),onClick:vi.fn((fn:()=>void)=>{press=fn;}),offClick:vi.fn()};
 vi.stubGlobal('window',{Telegram:{WebApp:{BackButton:button}}});
 const route=vi.fn(),modal=vi.fn();const leaveRoute=registerBack(route),leaveModal=registerBack(modal,100);
 try {press();expect(modal).toHaveBeenCalledTimes(1);expect(route).not.toHaveBeenCalled();leaveModal();press();expect(route).toHaveBeenCalledTimes(1);leaveRoute();expect(button.hide).toHaveBeenCalled();}
 finally {leaveModal();leaveRoute();vi.unstubAllGlobals();}
});
