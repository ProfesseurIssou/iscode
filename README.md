# ISCode Support 0.1.3
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
    "translation":{                                     //Possible translation
        "{{OutputFormatName}}":{
            "outputExtension":"{{OutputExtension}}",
            "table":{
                "{{InstructionName1}}":["{{REGEX WITH SELECTION GROUP}}","{{TRANSLATED CODE WITH %{{groupNumber}} }}"],
                "{{InstructionName2}}":["{{REGEX WITH SELECTION GROUP}}","{{TRANSLATED CODE WITH %{{groupNumber}} }}"]
            }
        }
    },
    "instructions":[                                    //Snippets
        {
            "name":"{{InstructionName1}}",
            "output":"{{Output1}}",
            "documentation":"{{InstructionDocumentation1}}",
            "commitChars":null
        },
        {
            "name":"{{InstructionName2}}",
            "output":"{{Output2}}",
            "documentation":"{{InstructionDocumentation2}}",
            "commitChars":null
        }
    ]
}
```

##### Exemple :

```JSON
{
    "name":"isc0",
    "translation":{
        "nasm_x86_x64":{
            "outputExtension":"nasm",
            "table":{
                "emptyLine":["^\n*$",""],                                                   //Empty line
                "architectureMode":["mode[ ]+([0-9]{1,3})","[BITS %1]"],                    //mode 64   TO  [BITS 64]
                "assign":["([a-zA-Z0-9]+)[ ]{0,}(=)[ ]{0,}([\\S]{1}.{0,})","mov %1,%3"]     //a=5       TO  mov a,5
            }
        }
    },
    "instructions":[
        {
            "name":"architectureMode",                                                      //mode selected
            "output":"mode[${1|8,16,32,64|}]",                                              //Selection between 8,16,32 and 64 bits
            "documentation":"Set architecture mode",
            "commitChars":null
        },
        {
            "name":"assign",                                                                //Assign
            "output":"${1} = ${2}",
            "documentation":"Assign a register with value",
            "commitChars":null
        }
    ]
}
```


## REGEX Tips

### Indentation

```REGEX
^([ ]{0,})
```