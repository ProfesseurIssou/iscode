# ISCode Support 0.2.0
## Translate
Open your ISCode file
Press CTRL+SHIFT+P and type :
```
ISCode : Translate code
```
And press ENTER
Select the output format and wait

<br>
<br>
<br>
<br>


## Create or Add my own translation
1. Press CTRL+SHIFT+P and type :
```
ISCode : Open translate folder
```
2. And press ENTER

#### Import a translation :
3. Drag and drop the translation file into the folder
<br>

#### Create my translation :
3. Make a new file in JSON format : {fileExtention}.json

    ##### Example:
    "***testCode***.json" are selected when the current file format is "####.***testCode***"
<br>
4. Copy paste the next json pattern and define your translation table :

```JSON
{
    "name":"{{FormatExtension}}",
    "availableTranslation":{
        "{{OutputFormatName}}":"{{OutputFileExtension}}"
    },
    "tokens":{
        "{{ExprName1}}":"{{REGEX1}}",
        "{{ExprName2}}":"{{REGEX2}}",
        "{{ExprName3}}":"{{REGEX3}}",

    },
    "instructions":{
        "{{InstructionName1}}":{
            "syntax":[
                "{{ExprName1}}"
            ],
            "snippet":{
                "output":"{{Output1}}",
                "documentation":"{{InstructionDocumentation1}}",
                "commitChars":null
            },
            "translation":{
                "{{OutputFormatName}}":"{{TRANSLATED CODE WITH %{{syntaxIndex}} }}"
            }
        }
    }
}
```

##### Exemple :

```JSON
{
    "name":"isc0",                                                      //Name of file extension
    "availableTranslation":{                                            //List of all possible translation
        "nasm_x86_x64":"nasm"                                               //OutputName : Output file extension
    },
    "tokens":{                                                          //List of all tokens
        "all":".*",

        "doubleSlash":"[/]{2}",
        "indentation":"[ ]{0,}",
        "space":"[ ]{1,}",

        "numbers":"[0-9]{1,}",
        "communData":"[a-zA-Z0-9_\\[\\]\\-\\+\\*\\,\\$]{1,}",

        "InstMode":"mode",
        "InstSyscall":"syscall",

    },
    "instructions":{                                                    //List of all instructions
        "architectureMode":{
            "syntax":[                                                      //Syntax of the instruction (with tokens name)
                "indentation",
                "InstMode",
                "space",
                "numbers"
            ],
            "snippet":{                                                     //Autocomplete
                "output":"mode ${1|8,16,32,64|}",
                "documentation":"Set architecture mode",
                "commitChars":null
            },
            "translation":{
                "nasm_x86_x64":"%1bits%3%4"
            },
        "syscall":{
            "syntax":[
                "indentation",
                "InstSyscall",
                "space",
                "communData"
            ],
            "snippet":{
                "output":"syscall ${1}",
                "documentation":"System call",
                "commitChars":null
            },
            "translation":{
                "nasm_x86_x64":"%1int%3%4"
            }
        }
    }
}
```