import { MonarchLanguage } from "./monarch";

/*Coloration NASM minimale pour la sortie .nasm : registres, instructions courantes,
	directives de section, chaînes, nombres, labels et commentaires ";".*/
const REGISTERS = "rax|rbx|rcx|rdx|rsi|rdi|rbp|rsp|rip|r8|r9|r10|r11|r12|r13|r14|r15|" +
	"eax|ebx|ecx|edx|esi|edi|ebp|esp|" +
	"ax|bx|cx|dx|si|di|bp|sp|al|bl|cl|dl";

const INSTRUCTIONS = "mov|push|pop|call|ret|add|sub|mul|div|inc|dec|cmp|jmp|je|jne|jg|jl|jge|jle|" +
	"syscall|int|db|dw|dd|dq|dt|resb|resw|resd|resq|rest|equ";

export const nasmMonarch: MonarchLanguage = {
	ignoreCase: false,
	tokenizer: {
		root: [
			[/;.*$/, "comment"],
			[/'[^'\n]*'/, "string"],
			[/\b(section|global|bits)\b/, "keyword"],
			[new RegExp("\\b(?:" + INSTRUCTIONS + ")\\b"), "keyword"],
			[new RegExp("\\b(?:" + REGISTERS + ")\\b"), "type"],
			[/0x[0-9a-fA-F]+|\d+/, "number"],
			[/[a-zA-Z_.$][\w.$]*:/, "identifier"]
		]
	}
};
